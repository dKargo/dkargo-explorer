/**
 * @file server.js
 * @notice Explorer Backend 메인파일 (express)
 * @author jhhong
 */

//// COMMON
const colors  = require('colors/safe'); // 콘솔 Color 출력
const express = require('express'); // express 패키지
const app     = express(); // express Object
const cors    = require('cors'); // CORS 관리 패키지
//// LOGs
const initLog       = require('../libs/libLog.js').initLog; // 로그 초기화 함수 (winston)
const enableLogFile = require('../libs/libLog.js').enableLogFile; // 로그 파일 출력기능 추가 함수

/**
 * @notice 사용법 출력함수이다.
 * @author jhhong
 */
function usage() {
    const fullpath = __filename.split('/');
    const filename = fullpath[fullpath.length - 1];
    console.log(colors.green("Usage:"));
    console.log(`> node ${filename} [argv1] [argv2] [argv3]`);
    console.log(`....[argv1]: Port Number`);
    console.log(`....[argv2]: Service Contract`);
    console.log(`....[argv3]: Token Contract`);
}

/**
 * @notice 메인 실행함수이다.
 * @author jhhong
 */
let RunProc = async function() {
    try {
        await initLog();
        await enableLogFile(`explorer/server`);
        if(process.argv.length != 5) {
            throw new Error("invalid paramters!");
        }
        let port = process.argv[2];
        let service = process.argv[3];
        let token = process.argv[4];
        await app.listen(port);
        console.log(colors.gray(`EXPLORER EXPRESS SERVER HAS STARTED ON PORT [${colors.cyan(port)}]`));
        app.use(express.json());
        app.use(express.urlencoded({extended: true}));
        app.use(cors());
        require('./router')(app, service, token);
    } catch(error) {
        console.log(colors.red(error));
        usage();
        process.exit(1);
    }
}
RunProc();