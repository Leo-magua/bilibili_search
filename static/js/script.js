// DOM 元素
const mobileMenuButton = document.getElementById('mobile-menu-button');
const mobileMenu = document.getElementById('mobile-menu');
const keywordFileInput = document.getElementById('keyword-file');
const fileNameDisplay = document.getElementById('file-name');
const requestDelaySlider = document.getElementById('request-delay');
const delayValueDisplay = document.getElementById('delay-value');
const startCrawlButton = document.getElementById('start-crawl');
const pauseCrawlButton = document.getElementById('pause-crawl');
const resumeCrawlButton = document.getElementById('resume-crawl');
const stopCrawlButton = document.getElementById('stop-crawl');
const progressSection = document.getElementById('progress');
const resultsSection = document.getElementById('results');
const statisticsSection = document.getElementById('statistics');
const overallProgressBar = document.getElementById('overall-progress-bar');
const overallProgressText = document.getElementById('overall-progress-text');
const statusIndicator = document.getElementById('status-indicator');
const currentStatus = document.getElementById('current-status');
const crawlLog = document.getElementById('crawl-log');
const downloadResultsButton = document.getElementById('download-results');
const notification = document.getElementById('notification');
const notificationIcon = document.getElementById('notification-icon');
const notificationMessage = document.getElementById('notification-message');
const searchResultsInput = document.getElementById('search-results');
const filterKeywordSelect = document.getElementById('filter-keyword');
const resultsTableBody = document.getElementById('results-table-body');
const pagination = document.getElementById('pagination');
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
// 新增DOM元素
const addKeywordBtn = document.getElementById('add-keyword-btn');
const keywordsContainer = document.getElementById('keywords-container');
const manualKeywordsInput = document.getElementById('manual-keywords-input');
const newKeywordInput = document.getElementById('new-keyword-input');
const confirmKeywordBtn = document.getElementById('confirm-keyword-btn');
const cancelKeywordBtn = document.getElementById('cancel-keyword-btn');

// 统计相关元素
const totalVideosElement = document.getElementById('total-videos');
const avgViewsElement = document.getElementById('avg-views');
const processedKeywordsElement = document.getElementById('processed-keywords');
const crawlDurationElement = document.getElementById('crawl-duration');
const completeTitlesElement = document.getElementById('complete-titles');
const completeAuthorsElement = document.getElementById('complete-authors');
const completeDescriptionsElement = document.getElementById('complete-descriptions');
const titlesProgressElement = document.getElementById('titles-progress');
const authorsProgressElement = document.getElementById('authors-progress');
const descriptionsProgressElement = document.getElementById('descriptions-progress');

// 全局变量
let isCrawling = false;
let isPaused = false;
let currentPage = 1;
let totalPages = 1;
let videosPerPage = 10;
let allVideos = [];
let filteredVideos = [];
let keywords = [];
let keywordsChart = null;
let viewsChart = null;
let startTime = null;
let endTime = null;
let statusPollingInterval = null;
// 关键词数组
let manualKeywords = [];

// 移动端菜单切换
mobileMenuButton.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
});

// 关键词文件上传处理
keywordFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        fileNameDisplay.textContent = `已选择: ${e.target.files[0].name}`;
        fileNameDisplay.classList.remove('hidden');
    } else {
        fileNameDisplay.classList.add('hidden');
    }
});

// 请求间隔滑块处理
requestDelaySlider.addEventListener('input', () => {
    delayValueDisplay.textContent = `${requestDelaySlider.value}秒`;
});

// 显示通知
function showNotification(message, type = 'info') {
    notificationMessage.textContent = message;
    
    // 设置图标和颜色
    if (type === 'success') {
        notificationIcon.className = 'fa fa-check-circle mr-2 text-green-400';
    } else if (type === 'error') {
        notificationIcon.className = 'fa fa-exclamation-circle mr-2 text-red-400';
    } else if (type === 'warning') {
        notificationIcon.className = 'fa fa-exclamation-triangle mr-2 text-yellow-400';
    } else {
        notificationIcon.className = 'fa fa-info-circle mr-2';
    }
    
    // 显示通知
    notification.classList.remove('translate-y-20', 'opacity-0');
    notification.classList.add('translate-y-0', 'opacity-100');
    
    // 3秒后隐藏
    setTimeout(() => {
        notification.classList.remove('translate-y-0', 'opacity-100');
        notification.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
}

// 添加日志
function addLog(message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('p');
    logEntry.className = isError ? 'text-red-500' : 'text-gray-600';
    logEntry.innerHTML = `<span class="text-gray-400">[${timestamp}]</span> ${message}`;
    
    // 清除初始提示
    if (crawlLog.querySelector('p.italic')) {
        crawlLog.innerHTML = '';
    }
    
    crawlLog.appendChild(logEntry);
    crawlLog.scrollTop = crawlLog.scrollHeight;
}

// 更新进度
function updateProgress(percent, status) {
    overallProgressBar.style.width = `${percent}%`;
    overallProgressText.textContent = `${Math.round(percent)}%`;
    currentStatus.textContent = status;
    
    // 更新状态指示器
    if (percent === 100) {
        statusIndicator.className = 'w-3 h-3 rounded-full bg-green-500 mr-2';
    } else if (isPaused) {
        statusIndicator.className = 'w-3 h-3 rounded-full bg-yellow-500 mr-2';
    } else {
        statusIndicator.className = 'w-3 h-3 rounded-full bg-primary mr-2 pulse-animation';
    }
}

// 在开始爬取函数中更新API调用
startCrawlButton.addEventListener('click', async () => {
    // 验证输入 - 更新为支持两种方式
    const hasFile = keywordFileInput.files.length > 0;
    const hasManualKeywords = manualKeywords.length > 0;
    
    if (!hasFile && !hasManualKeywords) {
        showNotification('请上传关键词文件或添加关键词', 'error');
        return;
    }
    
    // 显示进度区域
    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    statisticsSection.classList.add('hidden');
    
    // 重置进度
    updateProgress(0, '准备开始爬取...');
    crawlLog.innerHTML = '<p class="text-gray-400 italic">日志将显示在这里...</p>';
    
    // 更新按钮状态
    startCrawlButton.disabled = true;
    startCrawlButton.classList.add('btn-loading');
    pauseCrawlButton.classList.remove('hidden');
    stopCrawlButton.classList.remove('hidden');
    
    try {
        let formData;
        let endpoint;
        
        if (hasFile) {
            // 使用文件方式
            formData = new FormData();
            formData.append('file', keywordFileInput.files[0]);
            formData.append('pages', document.getElementById('pages-to-crawl').value);
            formData.append('enable_detailed_info', document.getElementById('enable-detailed-info').checked);
            formData.append('remove_duplicates', document.getElementById('remove-duplicates').checked);
            endpoint = '/upload-file';  // 修改为新的端点
        } else {
            // 使用手动关键词方式
            formData = new FormData();
            formData.append('keywords', JSON.stringify(manualKeywords));
            formData.append('pages', document.getElementById('pages-to-crawl').value);
            formData.append('enable_detailed_info', document.getElementById('enable-detailed-info').checked);
            formData.append('remove_duplicates', document.getElementById('remove-duplicates').checked);
            endpoint = '/start-with-keywords';
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('开始爬取视频信息');
            startStatusPolling();
            isCrawling = true;
            isPaused = false;
            startTime = new Date();
            
            // 更新关键词过滤器
            if (hasManualKeywords) {
                updateKeywordFilter(manualKeywords);
            } else if (data.keywords) {
                updateKeywordFilter(data.keywords);
            }
        } else {
            showNotification('错误: ' + data.error, 'error');
            resetUI();
        }
    } catch (error) {
        showNotification('请求失败: ' + error.message, 'error');
        resetUI();
    }
});

// 暂停爬取
pauseCrawlButton.addEventListener('click', async () => {
    try {
        const response = await fetch('/pause', { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            isPaused = true;
            pauseCrawlButton.classList.add('hidden');
            resumeCrawlButton.classList.remove('hidden');
            showNotification('爬取已暂停');
        }
    } catch (error) {
        showNotification('暂停失败: ' + error.message, 'error');
    }
});

// 继续爬取
resumeCrawlButton.addEventListener('click', async () => {
    try {
        const response = await fetch('/resume', { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            isPaused = false;
            resumeCrawlButton.classList.add('hidden');
            pauseCrawlButton.classList.remove('hidden');
            showNotification('爬取继续');
        }
    } catch (error) {
        showNotification('继续失败: ' + error.message, 'error');
    }
});

// 停止爬取
stopCrawlButton.addEventListener('click', async () => {
    if (confirm('确定要停止当前任务吗？')) {
        try {
            const response = await fetch('/stop', { method: 'POST' });
            const data = await response.json();
            
            if (response.ok) {
                stopStatusPolling();
                resetUI();
                showNotification('爬取已停止', 'warning');
            }
        } catch (error) {
            showNotification('停止失败: ' + error.message, 'error');
        }
    }
});

// 开始状态轮询
function startStatusPolling() {
    statusPollingInterval = setInterval(updateStatus, 1000);
}

// 停止状态轮询
function stopStatusPolling() {
    if (statusPollingInterval) {
        clearInterval(statusPollingInterval);
        statusPollingInterval = null;
    }
}

// 更新状态
async function updateStatus() {
    try {
        const response = await fetch('/status');
        const status = await response.json();
        
        updateUI(status);
        
        // 如果任务完成或出错，停止轮询
        if ((!status.is_running && status.progress === 100) || status.error) {
            if (status.progress === 100) {
                completeCrawling(status);
            } else if (status.error) {
                showNotification('任务出错: ' + status.error, 'error');
                resetUI();
            }
            stopStatusPolling();
        }
    } catch (error) {
        console.error('获取状态失败:', error);
    }
}

// 更新UI
function updateUI(status) {
    // 更新进度条
    updateProgress(status.progress, status.current_task || '处理中...');
    
    // 更新日志
    if (status.logs && status.logs.length > 0) {
        const currentLogCount = crawlLog.querySelectorAll('p').length;
        if (status.logs.length > currentLogCount) {
            // 只添加新的日志
            for (let i = currentLogCount; i < status.logs.length; i++) {
                const log = status.logs[i];
                addLog(log.message, log.is_error);
            }
        }
    }
    
    // 更新统计信息
    document.getElementById('totalKeywords').textContent = status.total_keywords || 0;
    document.getElementById('totalVideos').textContent = status.total_videos || 0;
    document.getElementById('processedKeywords').textContent = status.processed_keywords || 0;
    
    // 更新按钮状态
    if (status.is_running) {
        if (status.is_paused) {
            pauseCrawlButton.classList.add('hidden');
            resumeCrawlButton.classList.remove('hidden');
        } else {
            pauseCrawlButton.classList.remove('hidden');
            resumeCrawlButton.classList.add('hidden');
        }
    }
}

// 完成爬取
function completeCrawling(status) {
    isCrawling = false;
    endTime = new Date();
    
    // 更新按钮状态
    resetUI();
    
    // 显示结果和统计
    resultsSection.classList.remove('hidden');
    statisticsSection.classList.remove('hidden');
    
    // 显示通知
    showNotification('爬取完成，已获取所有视频信息', 'success');
    
    // 处理结果
    if (status.videos && status.videos.length > 0) {
        allVideos = status.videos;
        processResults();
        updateStatistics();
    }
}

// 重置UI
function resetUI() {
    startCrawlButton.disabled = false;
    startCrawlButton.classList.remove('btn-loading');
    pauseCrawlButton.classList.add('hidden');
    resumeCrawlButton.classList.add('hidden');
    stopCrawlButton.classList.add('hidden');
    isCrawling = false;
    isPaused = false;
}

// 处理结果
function processResults() {
    // 填充关键词过滤器
    const uniqueKeywords = [...new Set(allVideos.map(video => video['搜索关键词']))];
    filterKeywordSelect.innerHTML = '<option value="">所有关键词</option>';
    uniqueKeywords.forEach(keyword => {
        const option = document.createElement('option');
        option.value = keyword;
        option.textContent = keyword;
        filterKeywordSelect.appendChild(option);
    });
    
    // 初始化过滤
    filteredVideos = [...allVideos];
    renderResults();
}

// 渲染结果表格
function renderResults() {
    // 计算分页
    totalPages = Math.ceil(filteredVideos.length / videosPerPage);
    if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
    
    // 获取当前页数据
    const startIndex = (currentPage - 1) * videosPerPage;
    const currentVideos = filteredVideos.slice(startIndex, startIndex + videosPerPage);
    
    // 清空表格
    resultsTableBody.innerHTML = '';
    
    // 填充表格
    if (currentVideos.length === 0) {
        resultsTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-10 text-center text-gray-500">
                    没有找到匹配的视频
                </td>
            </tr>
        `;
    } else {
        currentVideos.forEach(video => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 transition-colors';
            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${video.bvid || ''}</td>
                <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title="${video.title || ''}">${video.title || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${video.author || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${(video.play || 0).toLocaleString()}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${video.pubdate || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${video['搜索关键词'] || ''}</td>
            `;
            resultsTableBody.appendChild(row);
        });
    }
    
    // 更新分页
    if (filteredVideos.length > 0) {
        pagination.classList.remove('hidden');
        pageInfo.textContent = `第 ${currentPage} 页，共 ${totalPages} 页`;
        prevPageButton.disabled = currentPage === 1;
        nextPageButton.disabled = currentPage === totalPages;
    } else {
        pagination.classList.add('hidden');
    }
}

// 搜索结果
searchResultsInput.addEventListener('input', () => {
    filterResults();
});

// 过滤关键词
filterKeywordSelect.addEventListener('change', () => {
    filterResults();
});

// 过滤结果
function filterResults() {
    const searchTerm = searchResultsInput.value.toLowerCase();
    const selectedKeyword = filterKeywordSelect.value;
    
    filteredVideos = allVideos.filter(video => {
        // 关键词过滤
        if (selectedKeyword && video['搜索关键词'] !== selectedKeyword) {
            return false;
        }
        
        // 搜索词过滤
        if (searchTerm && !(
            (video.title && video.title.toLowerCase().includes(searchTerm)) || 
            (video.author && video.author.toLowerCase().includes(searchTerm)) ||
            (video.bvid && video.bvid.toLowerCase().includes(searchTerm))
        )) {
            return false;
        }
        
        return true;
    });
    
    // 重置页码
    currentPage = 1;
    renderResults();
}

// 上一页
prevPageButton.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderResults();
    }
});

// 下一页
nextPageButton.addEventListener('click', () => {
    if (currentPage < totalPages) {
        currentPage++;
        renderResults();
    }
});

// 下载结果
downloadResultsButton.addEventListener('click', () => {
    showNotification('正在生成Excel文件...');
    window.location.href = '/download';
});

// 更新统计信息
function updateStatistics() {
    // 基本统计
    totalVideosElement.textContent = allVideos.length;
    
    const totalViews = allVideos.reduce((sum, video) => sum + (video.play || 0), 0);
    const avgViews = allVideos.length > 0 ? Math.round(totalViews / allVideos.length) : 0;
    avgViewsElement.textContent = avgViews.toLocaleString();
    
    const uniqueKeywords = [...new Set(allVideos.map(video => video['搜索关键词']))];
    processedKeywordsElement.textContent = uniqueKeywords.length;
    
    const duration = startTime && endTime ? Math.round((endTime - startTime) / 1000) : 0;
    crawlDurationElement.textContent = `${duration}s`;
    
    // 数据质量统计
    const completeTitles = allVideos.filter(v => v.title && v.title.trim() !== '').length;
    const titlesPercent = allVideos.length > 0 ? Math.round((completeTitles / allVideos.length) * 100) : 0;
    completeTitlesElement.textContent = `${titlesPercent}%`;
    titlesProgressElement.style.width = `${titlesPercent}%`;
    
    const completeAuthors = allVideos.filter(v => v.author && v.author.trim() !== '').length;
    const authorsPercent = allVideos.length > 0 ? Math.round((completeAuthors / allVideos.length) * 100) : 0;
    completeAuthorsElement.textContent = `${authorsPercent}%`;
    authorsProgressElement.style.width = `${authorsPercent}%`;
    
    const completeDescriptions = allVideos.filter(v => v.description && v.description.trim() !== '').length;
    const descriptionsPercent = allVideos.length > 0 ? Math.round((completeDescriptions / allVideos.length) * 100) : 0;
    completeDescriptionsElement.textContent = `${descriptionsPercent}%`;
    descriptionsProgressElement.style.width = `${descriptionsPercent}%`;
    
    // 关键词分布图表
    const keywordCounts = {};
    allVideos.forEach(video => {
        const keyword = video['搜索关键词'];
        if (keyword) {
            keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
        }
    });
    
    const ctx1 = document.getElementById('keywords-chart').getContext('2d');
    if (keywordsChart) {
        keywordsChart.destroy();
    }
    
    if (Object.keys(keywordCounts).length > 0) {
        keywordsChart = new Chart(ctx1, {
            type: 'pie',
            data: {
                labels: Object.keys(keywordCounts),
                datasets: [{
                    data: Object.values(keywordCounts),
                    backgroundColor: [
                        '#FB7299', '#23ADE5', '#7289DA', '#3BA55C', '#FAA61A',
                        '#99AAB5', '#6C63FF', '#FF6B6B', '#4ECDC4', '#FFA07A'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 12,
                            font: {
                                size: 11
                            }
                        }
                    }
                }
            }
        });
    }
    
    // 播放量分布图表
    const viewsRanges = {
        '1k以下': 0,
        '1k-10k': 0,
        '10k-100k': 0,
        '100k以上': 0
    };
    
    allVideos.forEach(video => {
        const views = video.play || 0;
        if (views < 1000) {
            viewsRanges['1k以下']++;
        } else if (views < 10000) {
            viewsRanges['1k-10k']++;
        } else if (views < 100000) {
            viewsRanges['10k-100k']++;
        } else {
            viewsRanges['100k以上']++;
        }
    });
    
    const ctx2 = document.getElementById('views-chart').getContext('2d');
    if (viewsChart) {
        viewsChart.destroy();
    }
    
    viewsChart = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: Object.keys(viewsRanges),
            datasets: [{
                label: '视频数量',
                data: Object.values(viewsRanges),
                backgroundColor: '#23ADE5',
                borderColor: '#23ADE5',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

// 平滑滚动
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        const targetId = this.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        
        if (targetElement) {
            window.scrollTo({
                top: targetElement.offsetTop - 80,
                behavior: 'smooth'
            });
            
            // 关闭移动菜单
            mobileMenu.classList.add('hidden');
        }
    });
});

// 滚动时改变导航栏样式
window.addEventListener('scroll', () => {
    const header = document.querySelector('header');
    if (window.scrollY > 10) {
        header.classList.add('py-2');
        header.classList.remove('py-4');
    } else {
        header.classList.add('py-4');
        header.classList.remove('py-2');
    }
});

// 文件拖拽功能
const uploadArea = document.querySelector('.file-upload-area');
if (uploadArea) {
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            keywordFileInput.files = files;
            fileNameDisplay.textContent = `已选择: ${files[0].name}`;
            fileNameDisplay.classList.remove('hidden');
        }
    });
}

// 添加关键词按钮点击事件
addKeywordBtn.addEventListener('click', () => {
    manualKeywordsInput.classList.remove('hidden');
    newKeywordInput.focus();
    addKeywordBtn.disabled = true;
});

// 确认添加关键词
confirmKeywordBtn.addEventListener('click', () => {
    const keyword = newKeywordInput.value.trim();
    if (keyword) {
        addManualKeyword(keyword);
        newKeywordInput.value = '';
        manualKeywordsInput.classList.add('hidden');
        addKeywordBtn.disabled = false;
    }
});

// 取消添加关键词
cancelKeywordBtn.addEventListener('click', () => {
    newKeywordInput.value = '';
    manualKeywordsInput.classList.add('hidden');
    addKeywordBtn.disabled = false;
});

// 回车键添加关键词
newKeywordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        confirmKeywordBtn.click();
    }
});

// 添加手动关键词
function addManualKeyword(keyword) {
    if (!manualKeywords.includes(keyword)) {
        manualKeywords.push(keyword);
        renderManualKeywords();
        showNotification(`已添加关键词: ${keyword}`, 'success');
    } else {
        showNotification('关键词已存在', 'warning');
    }
}

// 删除手动关键词
function removeManualKeyword(keyword) {
    manualKeywords = manualKeywords.filter(k => k !== keyword);
    renderManualKeywords();
    showNotification(`已删除关键词: ${keyword}`, 'info');
}

// 渲染手动关键词
function renderManualKeywords() {
    keywordsContainer.innerHTML = '';
    
    if (manualKeywords.length === 0) {
        keywordsContainer.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">暂无关键词，点击上方按钮添加</p>';
        return;
    }
    
    manualKeywords.forEach(keyword => {
        const keywordElement = document.createElement('div');
        keywordElement.className = 'keyword-tag keyword-fade-in';
        keywordElement.innerHTML = `
            <span>${keyword}</span>
            <span class="remove-btn" onclick="removeManualKeyword('${keyword}')">
                <i class="fa fa-times"></i>
            </span>
        `;
        keywordsContainer.appendChild(keywordElement);
    });
}

// 在开始爬取函数中更新验证逻辑
startCrawlButton.addEventListener('click', async () => {
    // 验证输入 - 更新为支持两种方式
    const hasFile = keywordFileInput.files.length > 0;
    const hasManualKeywords = manualKeywords.length > 0;
    
    if (!hasFile && !hasManualKeywords) {
        showNotification('请上传关键词文件或添加关键词', 'error');
        return;
    }
    
    // 显示进度区域
    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    statisticsSection.classList.add('hidden');
    
    // 重置进度
    updateProgress(0, '准备开始爬取...');
    crawlLog.innerHTML = '<p class="text-gray-400 italic">日志将显示在这里...</p>';
    
    // 更新按钮状态
    startCrawlButton.disabled = true;
    startCrawlButton.classList.add('btn-loading');
    pauseCrawlButton.classList.remove('hidden');
    stopCrawlButton.classList.remove('hidden');
    
    try {
        let formData;
        let endpoint;
        
        if (hasFile) {
            // 使用文件方式
            formData = new FormData();
            formData.append('file', keywordFileInput.files[0]);
            formData.append('pages', document.getElementById('pages-to-crawl').value);
            formData.append('enable_detailed_info', document.getElementById('enable-detailed-info').checked);
            formData.append('remove_duplicates', document.getElementById('remove-duplicates').checked);
            endpoint = '/upload';
        } else {
            // 使用手动关键词方式
            formData = new FormData();
            formData.append('keywords', JSON.stringify(manualKeywords));
            formData.append('pages', document.getElementById('pages-to-crawl').value);
            formData.append('enable_detailed_info', document.getElementById('enable-detailed-info').checked);
            formData.append('remove_duplicates', document.getElementById('remove-duplicates').checked);
            endpoint = '/start-with-keywords';
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('开始爬取视频信息');
            startStatusPolling();
            isCrawling = true;
            isPaused = false;
            startTime = new Date();
            
            // 更新关键词过滤器
            if (hasManualKeywords) {
                updateKeywordFilter(manualKeywords);
            }
        } else {
            showNotification('错误: ' + data.error, 'error');
            resetUI();
        }
    } catch (error) {
        showNotification('请求失败: ' + error.message, 'error');
        resetUI();
    }
});

// 更新关键词过滤器
function updateKeywordFilter(keywordsList) {
    filterKeywordSelect.innerHTML = '<option value="">所有关键词</option>';
    keywordsList.forEach(keyword => {
        const option = document.createElement('option');
        option.value = keyword;
        option.textContent = keyword;
        filterKeywordSelect.appendChild(option);
    });
}

// 在processResults函数中更新关键词过滤器的填充
function processResults() {
    // 填充关键词过滤器
    const uniqueKeywords = [...new Set(allVideos.map(video => video['搜索关键词']))];
    updateKeywordFilter(uniqueKeywords);
    
    // 初始化过滤
    filteredVideos = [...allVideos];
    renderResults();
}

// 添加批量导入关键词的功能（可选）
function addBatchKeywords(keywordsText) {
    const keywordsArray = keywordsText.split('\n')
        .map(k => k.trim())
        .filter(k => k);
    
    let addedCount = 0;
    keywordsArray.forEach(keyword => {
        if (!manualKeywords.includes(keyword)) {
            manualKeywords.push(keyword);
            addedCount++;
        }
    });
    
    renderManualKeywords();
    showNotification(`批量添加了 ${addedCount} 个关键词`, 'success');
}

// 添加批量导入按钮（可选功能）
function addBatchImportFeature() {
    const batchImportHTML = `
        <div class="mt-2">
            <details class="text-sm">
                <summary class="cursor-pointer text-primary hover:text-primary/80">批量导入关键词</summary>
                <div class="mt-2">
                    <textarea id="batch-keywords-input" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors" placeholder="每行一个关键词&#10;例如：&#10;Python教程&#10;数据分析&#10;机器学习"></textarea>
                    <button type="button" onclick="handleBatchImport()" class="mt-2 px-4 py-2 bg-secondary hover:bg-secondary/90 text-white rounded-md transition-colors text-sm">
                        <i class="fa fa-upload mr-1"></i> 批量导入
                    </button>
                </div>
            </details>
        </div>
    `;
    
    // 在关键词容器后插入批量导入功能
    keywordsContainer.insertAdjacentHTML('afterend', batchImportHTML);
}

// 处理批量导入
function handleBatchImport() {
    const batchInput = document.getElementById('batch-keywords-input');
    const keywordsText = batchInput.value.trim();
    
    if (keywordsText) {
        addBatchKeywords(keywordsText);
        batchInput.value = '';
    } else {
        showNotification('请输入要导入的关键词', 'warning');
    }
}

// 初始化时添加批量导入功能
document.addEventListener('DOMContentLoaded', () => {
    addBatchImportFeature();
});