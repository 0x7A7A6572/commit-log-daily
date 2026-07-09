import { spawn } from 'node:child_process';

/**
 * 解析编辑器命令
 * 优先级：$EDITOR → $VISUAL → 平台默认（win32 → notepad, 其他 → nano）
 */
export function resolveEditor(): string {
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (editor) return editor;

    if (process.platform === 'win32') {
        return 'notepad';
    }
    return 'nano';
}

/**
 * GUI 编辑器列表 — 这些编辑器需要 detached: true，不阻塞终端
 */
const GUI_EDITORS = new Set([
    'notepad', 'notepad.exe', 'code', 'code.cmd', 'code.exe',
    'atom', 'subl', 'sublime_text', 'sublime_text.exe',
    'gedit', 'gnome-text-editor',
    'TextEdit', 'open',  // macOS
    'start',              // Windows fallback
]);

/** 判断是否为 GUI 编辑器 */
function isGuiEditor(cmd: string): boolean {
    const base = cmd.split(/[/\\]/).pop()?.toLowerCase() ?? cmd.toLowerCase();
    return GUI_EDITORS.has(base) || GUI_EDITORS.has(cmd.toLowerCase());
}

/**
 * 在外部编辑器中打开文件
 * - GUI 编辑器：detached: true，不阻塞 TUI，fire-and-forget
 * - 终端编辑器（vim/nano）：stdio: 'inherit'，复用当前终端
 *
 * @returns Promise，终端编辑器等待进程退出后 resolve，GUI 编辑器立即 resolve
 */
export function openInEditor(filePath: string): Promise<void> {
    const editorCmd = resolveEditor();

    return new Promise((resolve, reject) => {
        try {
            const useGui = isGuiEditor(editorCmd);

            const child = spawn(editorCmd, [filePath], {
                detached: useGui,
                stdio: useGui ? 'ignore' : 'inherit',
                shell: process.platform === 'win32',
            });

            if (useGui) {
                // GUI 编辑器 — 不等待，立即 resolve
                child.on('error', () => {});
                child.unref();
                resolve();
            } else {
                // 终端编辑器 — 等待进程退出
                child.on('close', (code) => {
                    if (code !== null && code !== 0) {
                        reject(new Error(`编辑器异常退出 (exit ${code})`));
                    } else {
                        resolve();
                    }
                });

                child.on('error', (err) => {
                    const code = (err as NodeJS.ErrnoException).code;
                    if (code === 'ENOENT') {
                        reject(
                            new Error(`未找到编辑器 "${editorCmd}"，请设置 $EDITOR 环境变量`),
                        );
                    } else {
                        reject(new Error(`启动编辑器失败: ${err.message}`));
                    }
                });
            }
        } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
