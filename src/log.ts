import * as vscode from 'vscode';

export let config: any = {};
export function getConfig() {

    return config;
}

/**
 * @param cat Type String --> define Cathegory [info,warn,error]
 * @param o   Rest Parameter, Type Any --> Data to Log
 */
export let outputChannel = vscode.window.createOutputChannel("Makefile Helper");
export function log(cat: string, ...o: any) {
    function mapObject(obj: any) {
        switch (typeof obj) {
            case 'undefined':
                return 'undefined';

            case 'string':
                return obj;

            case 'number':
                return obj.toString;

            case 'object':
                let ret: string = '';
                for (const [key, value] of Object.entries(obj)) {
                    ret += (`${key}: ${value}\n`);
                }
                return ret;

            default:
                return obj; //function,symbol,boolean

        }
    }

    var now = new Date();
    outputChannel.append(now.toLocaleTimeString('en', { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, '0'));
    switch (cat.toLowerCase()) {
        case 'warn':
            outputChannel.append(' [WARN] ');
            o.map((args: any) => {
                outputChannel.append(' ' + mapObject(args));
            });
            outputChannel.appendLine("")
            // outputChannel.show();
            return;

        case 'error':
            let err: string = '';
            outputChannel.append(' [ERROR] ');
            o.map((args: any) => {
                err += mapObject(args);
            });
            outputChannel.append(err);
            vscode.window.showErrorMessage(err);
            outputChannel.appendLine("")
            // outputChannel.show();
            return;

        default:
            outputChannel.append(' [INFO] ');
            o.map((args: any) => {
                outputChannel.append(' ' + mapObject(args));
            });
            outputChannel.appendLine("")
            // outputChannel.show();
            return;
    }

}

function info(...o: any) {
    log('info', ...o);
}
function warn(...o: any) {
    log('warn', ...o)
}
function error(...o: any) {
    log('error', ...o)
}

export {
    info,
    warn,
    error
}