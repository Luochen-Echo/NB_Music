const { app, BrowserWindow, session, ipcMain, Menu, Tray, shell } = require("electron");
const path = require("path");
const puppeteer = require("puppeteer");
const electronReload = require("electron-reload");
const Storage = require("electron-store");
const axios = require('axios');
const { autoUpdater } = require("electron-updater");
const storage = new Storage();
function parseCommandLineArgs() {
    const args = process.argv.slice(1);
    const showWelcomeArg = args.includes('--show-welcome');
    return {
        showWelcome: showWelcomeArg
    };
}
function setupAutoUpdater(win) {
    // 开发环境跳过更新检查
    if (!app.isPackaged) return;

    // 配置更新服务器
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'NB-Group',
        repo: 'NB_Music'
    });

    // 检查更新出错
    autoUpdater.on('error', (err) => {
        win.webContents.send('update-error', (err.message));
    });

    // 检查到新版本
    autoUpdater.on('update-available', (info) => {
        win.webContents.send('update-available', (info));
    });

    // 没有新版本
    autoUpdater.on('update-not-available', () => {
        win.webContents.send('update-not-available');
    });

    // 下载进度
    autoUpdater.on('download-progress', (progress) => {
        win.webContents.send('download-progress', (progress));
    });

    // 更新下载完成
    autoUpdater.on('update-downloaded', () => {
        // 通知渲染进程
        win.webContents.send('update-downloaded');

        // 提示重启应用
        const dialogOpts = {
            type: 'info',
            buttons: ['重启', '稍后'],
            title: '应用更新',
            message: '有新版本已下载完成,是否重启应用?'
        };

        require('electron').dialog.showMessageBox(dialogOpts).then((returnValue) => {
            if (returnValue.response === 0) autoUpdater.quitAndInstall();
        });
    });

    // 每小时检查一次更新
    setInterval(() => {
        autoUpdater.checkForUpdates();
    }, 60 * 60 * 1000);

    // 启动时检查更新
    autoUpdater.checkForUpdates();
}
function loadCookies() {
    if (!storage.has("cookies")) return null;
    return storage.get("cookies");
}

function saveCookies(cookieString) {
    storage.set("cookies", cookieString);
}

async function getBilibiliCookies() {
    const cachedCookies = loadCookies();
    if (cachedCookies) {
        return cachedCookies;
    }
    try {
        const browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null
        });
        const page = await browser.newPage();
        await page.goto("https://www.bilibili.com");
        const cookies = await page.cookies();
        const cookieString = formatCookieString(cookies);
        saveCookies(cookieString);
        await browser.close();
        return cookieString;
    } catch (error) {
        console.error('获取B站cookies失败:', error);
        return '';
    }
}

function getIconPath() {
    switch (process.platform) {
        case "win32":
            return path.join(__dirname, "../icons/icon.ico");
        case "darwin":
            return path.join(__dirname, "../icons/icon.png"); // 修改为使用 PNG 格式
        case "linux":
            return path.join(__dirname, "../icons/icon.png");
        default:
            return path.join(__dirname, "../icons/icon.png");
    }
}

// 创建托盘菜单
function createTrayMenu(win) {
    const iconPath = getIconPath();
    const tray = new Tray(iconPath);
    
    // 初始化托盘状态
    let isPlaying = false;
    let currentSong = { title: "未在播放", artist: "" };
    
    // 更新托盘菜单
    function updateTrayMenu() {
        const songInfo = currentSong.artist 
            ? `${currentSong.title} - ${currentSong.artist}` 
            : currentSong.title;
        
        const menuTemplate = [
            {
                label: '🎵 NB Music',
                enabled: false
            },
            { type: 'separator' },
            {
                label: songInfo,
                enabled: false
            },
            { type: 'separator' },
            {
                label: isPlaying ? '暂停' : '播放',
                click: () => {
                    win.webContents.send('tray-control', 'play-pause');
                }
            },
            {
                label: '上一曲',
                click: () => {
                    win.webContents.send('tray-control', 'prev');
                }
            },
            {
                label: '下一曲',
                click: () => {
                    win.webContents.send('tray-control', 'next');
                }
            },
            { type: 'separator' },
            {
                label: '显示主窗口',
                click: () => {
                    showWindow(win);
                }
            },
            {
                label: '设置',
                click: () => {
                    showWindow(win);
                    win.webContents.send('tray-control', 'show-settings');
                }
            },
            { type: 'separator' },
            {
                label: '检查更新',
                click: () => {
                    win.webContents.send('tray-control', 'check-update');
                }
            },
            {
                label: '关于',
                click: () => {
                    win.webContents.send('tray-control', 'about');
                }
            },
            { type: 'separator' },
            {
                label: '退出',
                click: () => {
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ];
        
        const contextMenu = Menu.buildFromTemplate(menuTemplate);
        tray.setContextMenu(contextMenu);
        
        // 设置工具提示显示当前播放信息
        tray.setToolTip(`NB Music - ${isPlaying ? '正在播放: ' : '已暂停: '}${songInfo}`);
    }
    
    // 单击托盘图标显示窗口
    tray.on("click", () => {
        showWindow(win);
    });
    
    // 监听来自渲染进程的托盘更新事件
    ipcMain.on('update-tray', (_, data) => {
        if (data.isPlaying !== undefined) isPlaying = data.isPlaying;
        if (data.song) currentSong = data.song;
        updateTrayMenu();
    });
    
    // 初始化菜单
    updateTrayMenu();
    
    return tray;
}

// 显示主窗口的辅助函数
function showWindow(win) {
    if (!win.isVisible()) {
        win.show();
    }
    if (win.isMinimized()) {
        win.restore();
    }
    win.focus();
}

function createWindow() {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    }
    
    // 创建主窗口
    const win = new BrowserWindow({
        frame: false,
        icon: getIconPath(),
        backgroundColor: "#2f3241",
        width: 1280,
        height: 800,
        minWidth: 1280,
        minHeight: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false
        },
        // 添加这些属性以改善窗口行为
        show: false, // 先不显示，等内容加载完再显示
        skipTaskbar: false
    });
    
    // 创建托盘
    const tray = createTrayMenu(win);
    
    // 当窗口准备好显示时才显示
    win.once('ready-to-show', () => {
        win.show();
        win.focus();
    });
    
    setupAutoUpdater(win);
    win.loadFile("src/main.html");
    win.maximize();
    
    if (!app.isPackaged) {
        win.webContents.openDevTools();
    }
    const cmdArgs = parseCommandLineArgs();
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('command-line-args', cmdArgs);
    });

    // 处理第二个实例启动的情况
    app.on("second-instance", (event, commandLine, workingDirectory) => {
        // 如果主窗口存在，确保它被显示、恢复并获得焦点
        if (win) {
            if (!win.isVisible()) win.show();
            if (win.isMinimized()) win.restore();
            win.focus();
            
            // 可以解析第二个实例的命令行参数并处理
            const secondInstanceArgs = parseCommandLineArgs(commandLine);
            if (secondInstanceArgs.showWelcome) {
                win.webContents.send('show-welcome');
            }
        }
    });

    // 设置应用退出标志
    app.isQuitting = false;

    // 修改窗口关闭行为
    win.on("close", (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            win.hide(); // 隐藏窗口而不是关闭
            return false;
        }
    });
    
    ipcMain.on("window-minimize", () => {
        win.minimize();
    });

    ipcMain.on("window-maximize", () => {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    });

    ipcMain.on("window-close", () => {
        win.hide(); // 修改为隐藏窗口
    });
    
    ipcMain.on("quit-app", () => {
        app.isQuitting = true;
        app.quit();
    });

    // 窗口状态变化时通知渲染进程
    win.on("maximize", () => {
        win.webContents.send("window-state-changed", true);
    });

    win.on("unmaximize", () => {
        win.webContents.send("window-state-changed", false);
    });
    
    win.on("show", () => {
        win.webContents.send("window-show");
    });
    
    win.on("hide", () => {
        win.webContents.send("window-hide");
    });

    // 返回窗口实例以便其他地方使用
    return win;
}

function formatCookieString(cookies) {
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join(";");
}

app.whenReady().then(async () => {
    if (!app.isPackaged) {
        require('electron-reload')(__dirname, {
            electron: path.join(process.cwd(), "node_modules", ".bin", "electron")
        });
    }
    
    // 存储主窗口的引用
    global.mainWindow = createWindow();
    
    setupIPC();
    
    const cookieString = await getBilibiliCookies();
    if (cookieString) {
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            if (details.url.includes("bilibili.com") ||
                details.url.includes("bilivideo.cn") ||
                details.url.includes("bilivideo.com")) {
                details.requestHeaders["Cookie"] = cookieString;
                details.requestHeaders["referer"] = "https://www.bilibili.com/";
                details.requestHeaders["user-agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";
            }
            callback({ requestHeaders: details.requestHeaders });
        });
    }
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
app.on('before-quit', () => {
    // 标记应用正在退出，这样可以防止窗口的关闭事件被阻止
    app.isQuitting = true;
});
if (!app.isPackaged) {
    electronReload(__dirname, {
        electron: path.join(process.cwd(), "node_modules", ".bin", "electron")
    });
}

function setupIPC() {
    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });

    ipcMain.on('check-for-updates', () => {
        // 如果不是打包后的应用，显示开发环境提示
        if (!app.isPackaged) {
            BrowserWindow.getFocusedWindow()?.webContents.send('update-not-available', {
                message: '开发环境中无法检查更新'
            });
            return;
        }
        
        // 执行更新检查
        autoUpdater.checkForUpdates()
            .catch(err => {
                console.error('更新检查失败:', err);
                BrowserWindow.getFocusedWindow()?.webContents.send('update-error', err.message);
            });
    });

    ipcMain.on('install-update', () => {
        // 安装已下载的更新
        autoUpdater.quitAndInstall(true, true);
    });

    ipcMain.on('open-external-link', (_, url) => {
        shell.openExternal(url);
    });

    // 添加退出应用的IPC处理
    ipcMain.on('quit-application', () => {
        app.isQuitting = true;
        app.quit();
    });
}
