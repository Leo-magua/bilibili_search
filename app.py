from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import requests
from bs4 import BeautifulSoup
import pandas as pd
import json
import re
import time
import random
import os
from urllib.parse import quote
from datetime import datetime
from tqdm import tqdm
import threading
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)
CORS(app)

# 配置
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB
app.config['ALLOWED_EXTENSIONS'] = {'xlsx', 'xls'}

# 确保上传目录存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# 全局变量存储任务状态
task_status = {
    'is_running': False,
    'is_paused': False,
    'progress': 0,
    'current_task': '',
    'total_keywords': 0,
    'processed_keywords': 0,
    'total_videos': 0,
    'current_keyword': '',
    'error': None,
    'logs': [],
    'videos': []
}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def read_keywords(filepath):
    """读取关键词Excel文件"""
    try:
        df = pd.read_excel(filepath)
        keywords = df['item'].tolist()
        return [str(keyword).strip() for keyword in keywords if pd.notna(keyword)]
    except Exception as e:
        print(f"读取关键词文件失败: {e}")
        return []

def encode_keyword(keyword):
    """将中文关键词转换为URL编码"""
    return quote(keyword, encoding='utf-8')

def extract_complete_titles_from_html(html_content):
    """从HTML中提取完整的标题信息，返回BVID到标题的映射"""
    bvid_title_map = {}
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        video_cards = soup.find_all('div', class_='bili-video-card__info--right')
        
        for card in video_cards:
            try:
                link = card.find('a', href=True)
                if link:
                    href = link.get('href', '')
                    bvid_match = re.search(r'/video/(BV[a-zA-Z0-9]+)/', href)
                    if bvid_match:
                        bvid = bvid_match.group(1)
                        title_elem = card.find('h3', class_='bili-video-card__info--tit')
                        if title_elem:
                            title = title_elem.get_text(strip=True)
                            if title:
                                bvid_title_map[bvid] = title
            except Exception as e:
                continue
        
        print(f"从HTML中提取到 {len(bvid_title_map)} 个完整标题")
        
    except Exception as e:
        print(f"从HTML提取完整标题失败: {e}")
    
    return bvid_title_map

def extract_video_blocks_from_js(script_content):
    """从JavaScript代码中提取每个视频的完整数据块"""
    video_blocks = []

    try:
        start_positions = []
        for match in re.finditer(r'\{type:f,', script_content):
            start_positions.append(match.start())

        print(f"找到 {len(start_positions)} 个可能的视频数据块")

        for start_pos in start_positions:
            video_block = extract_complete_object(script_content, start_pos)
            if video_block:
                video_blocks.append(video_block)

    except Exception as e:
        print(f"提取视频块失败: {e}")

    return video_blocks

def extract_complete_object(content, start_pos):
    """从指定位置提取完整的JavaScript对象"""
    try:
        if start_pos >= len(content) or content[start_pos] != '{':
            return None

        brace_count = 0
        pos = start_pos
        in_quotes = False
        escape_next = False

        while pos < len(content):
            char = content[pos]

            if char == '\\' and not escape_next:
                escape_next = True
                pos += 1
                continue

            if char == '"' and not escape_next:
                in_quotes = not in_quotes
            elif not in_quotes:
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        obj_str = content[start_pos:pos + 1]
                        return obj_str

            escape_next = False
            pos += 1

        return None
    except Exception as e:
        print(f"提取完整对象失败: {e}")
        return None

def parse_video_object(obj_str):
    """解析单个视频对象字符串"""
    try:
        video_info = {}

        fields = {
            'bvid': r'bvid:"([^"]*)"',
            'title': r'title:"([^"]*)"',
            'description': r'description:"([^"]*)"',
            'arcurl': r'arcurl:"([^"]*)"',
            'play': r'play:(\d+)',
            'review': r'review:(\d+)',
            'tag': r'tag:"([^"]*)"',
            'pubdate': r'pubdate:(\d+)',
            'duration': r'duration:"([^"]*)"',
        }

        for field, pattern in fields.items():
            match = re.search(pattern, obj_str)
            if match:
                value = match.group(1)

                if field in ['play', 'review', 'pubdate']:
                    video_info[field] = int(value) if value.isdigit() else 0
                else:
                    value = decode_js_string(value)
                    video_info[field] = value
            else:
                video_info[field] = '' if field not in ['play', 'review', 'pubdate'] else 0

        # 初始化新增字段
        video_info['author'] = ''
        video_info['uploadDate'] = ''

        if video_info.get('bvid') and video_info.get('bvid').startswith('BV'):
            return video_info

    except Exception as e:
        print(f"解析视频对象失败: {e}")

    return None

def decode_js_string(s):
    """解码JavaScript字符串中的转义字符"""
    try:
        s = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)

        replacements = {
            '\\n': '\n',
            '\\r': '\r',
            '\\t': '\t',
            '\\"': '"',
            '\\\\': '\\',
            '\\u002F': '/',
            '\\u003C': '<',
            '\\u003E': '>',
            '\\u0026': '&'
        }

        for old, new in replacements.items():
            s = s.replace(old, new)

        return s
    except:
        return s

def extract_videos_from_html(html_content):
    """从HTML内容中提取视频信息"""
    videos = []

    try:
        bvid_title_map = extract_complete_titles_from_html(html_content)
        soup = BeautifulSoup(html_content, 'html.parser')
        scripts = soup.find_all('script')

        for script in scripts:
            if not script.string:
                continue

            script_content = script.string

            if 'type:f' in script_content and 'bvid:' in script_content:
                print("找到包含视频数据的脚本")

                video_blocks = extract_video_blocks_from_js(script_content)
                print(f"提取到 {len(video_blocks)} 个视频数据块")

                for i, block in enumerate(video_blocks):
                    video_info = parse_video_object(block)
                    if video_info:
                        bvid = video_info.get('bvid', '')
                        if bvid in bvid_title_map:
                            video_info['title'] = bvid_title_map[bvid]
                        
                        videos.append(video_info)
                        print(f"解析视频 {i + 1}: {video_info['title'][:30]}...")

                break

    except Exception as e:
        print(f"从HTML提取视频失败: {e}")

    return videos

def timestamp_to_datetime(timestamp):
    """将时间戳转换为标准时间格式"""
    try:
        if timestamp and timestamp > 0:
            dt = datetime.fromtimestamp(timestamp)
            return dt.strftime('%Y-%m-%d %H:%M:%S')
        return ''
    except Exception as e:
        print(f"时间转换失败: {e}")
        return ''

def search_bilibili(keyword, page=1):
    """搜索B站视频"""
    encoded_keyword = encode_keyword(keyword)

    if page == 1:
        url = f"https://search.bilibili.com/all?keyword={encoded_keyword}"
    else:
        offset = (page - 1) * 30
        url = f"https://search.bilibili.com/all?keyword={encoded_keyword}&page={page}&o={offset}"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.bilibili.com',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin'
    }

    try:
        print(f"正在搜索: {keyword} - 第{page}页")
        response = requests.get(url, headers=headers, timeout=15)

        if response.status_code == 200:
            return response.text
        else:
            print(f"请求失败，状态码: {response.status_code}")
            return None

    except Exception as e:
        print(f"搜索失败: {e}")
        return None

def clean_title(title):
    """Remove '_哔哩哔哩_bilibili' suffix from title"""
    return title.replace('_哔哩哔哩_bilibili', '')

def clean_description(desc_text):
    """Extract description before '视频播放量' and remove trailing comma"""
    if '视频播放量' in desc_text:
        desc = desc_text.split('视频播放量')[0].strip()
    else:
        desc = desc_text.strip()
    if desc.endswith(','):
        desc = desc[:-1].strip()
    return desc

def scrape_detailed_video_info(url):
    """抓取视频详细信息"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Extract meta tags
            title_tag = soup.find('meta', {'itemprop': 'name'})
            author_tag = soup.find('meta', {'itemprop': 'author'})
            upload_date_tag = soup.find('meta', {'itemprop': 'uploadDate'})
            publish_date_tag = soup.find('meta', {'itemprop': 'datePublished'})
            desc_tag = soup.find('meta', {'itemprop': 'description'})
            
            title = clean_title(title_tag.get('content', '')) if title_tag else ''
            author = author_tag.get('content', '') if author_tag else ''
            upload_date = upload_date_tag.get('content', '') if upload_date_tag else ''
            publish_date = publish_date_tag.get('content', '') if publish_date_tag else ''
            
            # Extract and clean description
            full_desc = desc_tag.get('content', '') if desc_tag else ''
            description = clean_description(full_desc)
            
            return {
                'title': title,
                'author': author,
                'description': description,
                'uploadDate': upload_date,
                'datePublished': publish_date
            }
        else:
            print(f"Failed to retrieve {url}. Status code: {response.status_code}")
            return None
    except Exception as e:
        print(f"Error scraping {url}: {str(e)}")
        return None

def enrich_video_data(videos):
    """补充完整的视频信息"""
    print(f"\n{'='*50}")
    print("开始补充视频详细信息...")
    print(f"{'='*50}")
    
    enriched_videos = []
    
    for video in tqdm(videos, desc="补充视频信息"):
        url = video.get('arcurl', '')
        if url:
            # 抓取详细信息
            detailed_info = scrape_detailed_video_info(url)
            
            if detailed_info:
                # **替换原有字段**
                video['title'] = detailed_info['title']
                video['description'] = detailed_info['description']
                
                # **新增字段**
                video['author'] = detailed_info['author']
                video['uploadDate'] = detailed_info['uploadDate']
                
                # **替换pubdate字段（用datePublished）**
                if detailed_info['datePublished']:
                    video['pubdate'] = detailed_info['datePublished']
            
            # 随机延时，避免请求过快
            time.sleep(random.uniform(0.5, 1.5))
        
        enriched_videos.append(video)
    
    return enriched_videos

def add_log(message, is_error=False):
    """添加日志到任务状态"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    log_entry = {
        'timestamp': timestamp,
        'message': message,
        'is_error': is_error
    }
    task_status['logs'].append(log_entry)
    # 保持日志数量在合理范围内
    if len(task_status['logs']) > 100:
        task_status['logs'] = task_status['logs'][-100:]

def run_crawler_task(filename, pages_per_keyword=5, enable_detailed_info=True, remove_duplicates=True):
    """运行爬虫任务"""
    global task_status
    
    try:
        task_status['is_running'] = True
        task_status['is_paused'] = False
        task_status['progress'] = 0
        task_status['error'] = None
        task_status['logs'] = []
        task_status['videos'] = []
        
        # 读取关键词
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        keywords = read_keywords(filepath)
        if not keywords:
            task_status['error'] = "未找到关键词"
            add_log("未找到关键词", True)
            return

        task_status['total_keywords'] = len(keywords)
        task_status['processed_keywords'] = 0
        task_status['total_videos'] = 0
        
        add_log(f"找到 {len(keywords)} 个关键词")
        if filename.startswith('temp_keywords_'):
            add_log("使用手动输入的关键词")
        else:
            add_log(f"从文件 {filename} 读取关键词")
        
        print(f"找到 {len(keywords)} 个关键词")

        # 存储所有视频数据
        all_videos = []

        # **第一阶段：搜索并抓取基础信息**
        for i, keyword in enumerate(keywords):
            # 检查是否暂停
            while task_status['is_paused']:
                if not task_status['is_running']:
                    return
                time.sleep(1)
                
            # 检查是否停止
            if not task_status['is_running']:
                add_log("任务已停止")
                return

            task_status['current_keyword'] = keyword
            task_status['processed_keywords'] = i
            task_status['progress'] = int((i / len(keywords)) * 50)
            
            add_log(f"开始处理关键词: {keyword}")
            print(f"\n{'=' * 50}")
            print(f"开始处理关键词: {keyword}")
            print(f"{'=' * 50}")

            for page in range(1, pages_per_keyword + 1):
                add_log(f"处理第{page}页...")
                print(f"\n处理第{page}页...")
                html_content = search_bilibili(keyword, page)

                if html_content:
                    videos = extract_videos_from_html(html_content)

                    if videos:
                        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        for video in videos:
                            video['搜索关键词'] = keyword
                            video['操作时间'] = current_time
                            # 转换时间戳
                            if video.get('pubdate') and isinstance(video.get('pubdate'), int):
                                video['pubdate'] = timestamp_to_datetime(video['pubdate'])

                        all_videos.extend(videos)
                        task_status['total_videos'] = len(all_videos)
                        task_status['videos'] = all_videos
                        add_log(f"第{page}页成功获取到 {len(videos)} 个视频")
                        print(f"✓ 第{page}页成功获取到 {len(videos)} 个视频")

                    else:
                        add_log(f"第{page}页未获取到数据")
                        print(f"✗ 第{page}页未获取到数据")
                else:
                    add_log(f"第{page}页请求失败", True)
                    print(f"✗ 第{page}页请求失败")

                # 随机延时3-5秒
                delay = random.uniform(3, 5)
                add_log(f"等待 {delay:.1f} 秒...")
                print(f"等待 {delay:.1f} 秒...")
                time.sleep(delay)

            keyword_count = len([v for v in all_videos if v['搜索关键词'] == keyword])
            add_log(f"关键词 '{keyword}' 处理完成，共获取 {keyword_count} 个视频")
            print(f"\n关键词 '{keyword}' 处理完成，共获取 {keyword_count} 个视频")

        # **第二阶段：补充完整信息**
        if all_videos:
            task_status['progress'] = 50
            task_status['current_task'] = '正在补充视频详细信息...'
            add_log("开始补充视频详细信息...")
            
            print(f"\n{'=' * 50}")
            print(f"第一阶段完成，共获取 {len(all_videos)} 个视频")
            print(f"{'=' * 50}")
            
            # 去除重复数据（基于BVID）
            if remove_duplicates:
                df_temp = pd.DataFrame(all_videos)
                before_count = len(df_temp)
                df_temp = df_temp.drop_duplicates(subset=['bvid'], keep='first')
                after_count = len(df_temp)
                
                if before_count != after_count:
                    add_log(f"去除了 {before_count - after_count} 个重复视频")
                    print(f"去除了 {before_count - after_count} 个重复视频")
                
                # 转回列表进行信息补充
                all_videos = df_temp.to_dict('records')
            
            # **补充完整的视频信息**
            if enable_detailed_info:
                enriched_videos = enrich_video_data(all_videos)
            else:
                enriched_videos = all_videos
            
            # **第三阶段：保存数据**
            task_status['progress'] = 90
            task_status['current_task'] = '正在保存数据...'
            add_log("开始保存数据...")
            
            print(f"\n{'=' * 50}")
            print("开始保存数据...")
            
            df = pd.DataFrame(enriched_videos)

            # **调整列顺序（包含新增字段）**
            columns_order = [
                'bvid', 
                'title', 
                'arcurl', 
                'description', 
                'author',
                'uploadDate',
                'play', 
                'review',
                'tag', 
                'pubdate',
                'duration', 
                '搜索关键词', 
                '操作时间'
            ]

            # 确保所有列都存在
            for col in columns_order:
                if col not in df.columns:
                    df[col] = ''

            df = df[columns_order]

            # 保存到Excel文件
            output_filename = 'BVID.xlsx'
            df.to_excel(output_filename, index=False)
            
            task_status['progress'] = 100
            task_status['current_task'] = '任务完成！'
            task_status['videos'] = enriched_videos
            add_log(f"数据已保存到 {output_filename}")
            add_log(f"总共获取到 {len(df)} 个唯一视频数据")
            print(f"✓ 数据已保存到 {output_filename}")
            print(f"✓ 总共获取到 {len(df)} 个唯一视频数据")

        else:
            task_status['error'] = "未获取到任何数据"
            add_log("未获取到任何数据", True)
            print("未获取到任何数据")

    except Exception as e:
        task_status['error'] = f"任务执行出错: {str(e)}"
        add_log(f"任务执行出错: {str(e)}", True)
        print(f"任务执行出错: {e}")
    finally:
        task_status['is_running'] = False
        task_status['is_paused'] = False
        
        # 清理临时文件
        if filename.startswith('temp_keywords_'):
            try:
                temp_filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                if os.path.exists(temp_filepath):
                    os.remove(temp_filepath)
                    print(f"已清理临时文件: {filename}")
            except Exception as e:
                print(f"清理临时文件失败: {e}")

# 路由
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload-file', methods=['POST'])
def upload_file():
    """处理文件上传"""
    if 'file' not in request.files:
        return jsonify({'error': '没有文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # 获取参数
        pages = request.form.get('pages', 5, type=int)
        enable_detailed_info = request.form.get('enable_detailed_info', 'true') == 'true'
        remove_duplicates = request.form.get('remove_duplicates', 'true') == 'true'
        
        # 在新线程中运行爬虫任务
        thread = threading.Thread(
            target=run_crawler_task, 
            args=(filename, pages, enable_detailed_info, remove_duplicates)
        )
        thread.daemon = True
        thread.start()
        
        # 读取关键词用于前端显示
        keywords = read_keywords(filepath)
        
        return jsonify({
            'message': '文件上传成功，开始爬取数据', 
            'filename': filename,
            'keywords_count': len(keywords),
            'keywords': keywords
        })
    
    return jsonify({'error': '文件类型不支持'}), 400

@app.route('/start-with-keywords', methods=['POST'])
def start_with_keywords():
    """处理手动关键词"""
    try:
        # 获取手动输入的关键词
        keywords_json = request.form.get('keywords')
        if not keywords_json:
            return jsonify({'error': '没有提供关键词'}), 400
        
        keywords = json.loads(keywords_json)
        if not keywords or not isinstance(keywords, list):
            return jsonify({'error': '关键词格式不正确'}), 400
        
        # 获取其他参数
        pages = request.form.get('pages', 5, type=int)
        enable_detailed_info = request.form.get('enable_detailed_info', 'true') == 'true'
        remove_duplicates = request.form.get('remove_duplicates', 'true') == 'true'
        
        # 保存关键词到临时文件
        temp_filename = f"temp_keywords_{int(time.time())}.xlsx"
        temp_filepath = os.path.join(app.config['UPLOAD_FOLDER'], temp_filename)
        
        # 创建临时Excel文件
        df = pd.DataFrame({'item': keywords})
        df.to_excel(temp_filepath, index=False)
        
        # 在新线程中运行爬虫任务
        thread = threading.Thread(
            target=run_crawler_task, 
            args=(temp_filename, pages, enable_detailed_info, remove_duplicates)
        )
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'message': '开始爬取数据', 
            'keywords_count': len(keywords),
            'keywords': keywords
        })
        
    except Exception as e:
        return jsonify({'error': f'处理关键词失败: {str(e)}'}), 500

@app.route('/status')
def get_status():
    return jsonify(task_status)

@app.route('/pause', methods=['POST'])
def pause_task():
    global task_status
    if task_status['is_running'] and not task_status['is_paused']:
        task_status['is_paused'] = True
        add_log("任务已暂停")
    return jsonify({'message': '任务已暂停'})

@app.route('/resume', methods=['POST'])
def resume_task():
    global task_status
    if task_status['is_running'] and task_status['is_paused']:
        task_status['is_paused'] = False
        add_log("任务继续执行")
    return jsonify({'message': '任务继续执行'})

@app.route('/stop', methods=['POST'])
def stop_task():
    global task_status
    task_status['is_running'] = False
    task_status['is_paused'] = False
    task_status['current_task'] = '任务已停止'
    add_log("任务已停止")
    return jsonify({'message': '任务已停止'})

@app.route('/download')
def download_file():
    if os.path.exists('BVID.xlsx'):
        return send_file('BVID.xlsx', as_attachment=True, download_name='BVID.xlsx')
    else:
        return jsonify({'error': '文件不存在'}), 404

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8082)