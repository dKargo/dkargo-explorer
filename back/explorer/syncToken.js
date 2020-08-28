/**
 * @file syncToken.js
 * @notice Blockchain 내 정보를 동기화한다.
 * @author jhhong
 */

//// COMMON
const colors = require('colors/safe'); // 콘솔 Color 출력
const web3   = require('../libs/Web3.js').prov2; // web3 provider (물류 관련 contract는 privnet에 올라간다 (prov2))

//// LOGs
const initLog = require('../libs/libLog.js').initLog; // 로그 초기화 함수 (winston)
const Log     = require('../libs/libLog.js').Log; // 로그 출력

//// ABIs
const abiPrefix = require('../build/contracts/DkargoPrefix.json').abi; // 컨트랙트 ABI (DkargoPrefix)
const abiERC165 = require('../build/contracts/ERC165.json').abi; // 컨트랙트 ABI (ERC165)
const abiToken  = require('../build/contracts/DkargoToken.json').abi; // 컨트랙트 ABI (DkargoToken)

//// DBs
require('./db.js'); // for mongoose schema import
const mongoose = require('mongoose');
const Block    = mongoose.model('ExpBlock'); // module.exports
const TxToken  = mongoose.model('ExpTxToken'); // module.exports

//// APIs
const ApiToken = require('../libs/libDkargoToken.js'); // 토큰 컨트랙트 관련 Library


/**
 * @notice 사용법 출력함수이다.
 * @author jhhong
 */
function usage() {
    const fullpath = __filename.split('/');
    const filename = fullpath[fullpath.length - 1];
    console.log(colors.green("Usage:"));
    console.log(`> node ${filename} [argv1] [argv2]`);
    console.log(`....[argv1]: Token Address`);
    console.log(`....[argv2]: Start Block`);
}

/**
 * @notice ca가 디카르고 컨트랙트 증명을 위한 인터페이스를 지원하는지 확인한다.
 * @param {string} ca 컨트랙트 주소
 * @return boolean (true: 지원(O), false: 지원(X))
 * @author jhhong
 */
let isDkargoContract = async function(ca) {
    try {
        let ERC165 = new web3.eth.Contract(abiERC165, ca);
        if(await ERC165.methods.supportsInterface('0x01ffc9a7').call() != true) {
            throw new Error(`<supportsInterface> Not Supported!`);
        }
        if(await ERC165.methods.supportsInterface('0x946edbed').call() != true) {
            throw new Error(`<getDkargoPrefix> Not Supported!`);
        }
        return true;
    } catch(error) {
        let action = `Action: isDkargoContract`;
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
        return false;
    }
}

/**
 * @notice 디카르고 컨트랙트의 Prefix를 읽어온다.
 * @param {string} ca 컨트랙트 주소
 * @return Prefix(String:정상수행) / null(오류발생)
 * @author jhhong
 */
let getDkargoPrefix = async function(ca) {
    try {
        let DkargoPrefix = new web3.eth.Contract(abiPrefix, ca);
        return await DkargoPrefix.methods.getDkargoPrefix().call();
    } catch(error) {
        let action = `Action: getDkargoPrefix`;
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
        return false;
    }
}

/**
 * @notice 블록에 token 컨트랙트가 실제로 존재하는지 확인한다.
 * @param {String} addr token 컨트랙트 주소
 * @param {Number} genesis token 컨트랙트가 deploy된 블록넘버
 * @return boolean (true: 존재함, false: 존재하지 않음)
 * @author jhhong
 */
let checkValidGenesis = async function(addr, genesis) {
    try {
        let data = await web3.eth.getBlock(genesis, true); // 제네시스 블록의 블록정보를 읽어옴
        if(data == null) {
            throw new Error(`null data received!`);
        }
        Log('DEBUG', `block: [${colors.green(data.number)}] txnum: [${colors.green(data.transactions.length)}]`);
        for(d in data.transactions) {
            const txdata = data.transactions[d];
            const receipt = await web3.eth.getTransactionReceipt(txdata.hash);
            if(txdata.input && txdata.input.length > 2 && txdata.to === null) { // CONTRACT DEPLOY를 수행하는 TX
                let ca = receipt.contractAddress.toLowerCase();
                if(ca == addr.toLowerCase() && await isDkargoContract(ca) == true) { // 해당 컨트랙트(ca)가 디카르고 컨트랙트 증명을 위한 인터페이스를 지원함
                    let prefix = await getDkargoPrefix(ca); // 해당 컨트랙트(ca)의 prefix를 읽어옴
                    if(prefix == 'token') {
                        return true;
                    }
                }
            }
        }
        return false;
    } catch(error) {
        let action = `Action: checkValidGenesis`;
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
        return false;
    }
}

/**
 * @notice 모니터링 시작 블록넘버를 구한다.
 * @param {String} addr service 컨트랙트 주소
 * @param {Number} defaultblock service 컨트랙트가 deploy된 블록넘버 (process.argv[3])
 * @return 모니터링 시작 블록넘버(Number)
 * @author jhhong
 */
let getStartBlock = async function(addr, defaultblock) {
    try {
        if(await checkValidGenesis(addr, defaultblock) == false) { // 파라메터 validation 체크
            throw new Error(`Invalid Genesis! BlockNumber: [${defaultblock}]`);
        }
        if(await Block.countDocuments({nettype: 'token'}) == 0) {
            if(await TxToken.countDocuments() == 0) { // DB에 저장된 내용이 없는 최초상태
                return defaultblock;
            } else {
                throw new Error(`Need to reset DB! (Work schema exist)`);
            }
        } else { // genesis block을 마지막 처리된 blockNumber로 설정
            let latest = await Block.findOne();
            if(latest.blockNumber >= defaultblock) { // 마지막 처리된 이벤트 내용을 Work Schema에서 삭제 (중복저장 방지)
                let ret = await TxToken.deleteMany({blocknumber: latest.blockNumber});
                if(ret != null) {
                    let action = `TxToken.deleteMany done!\n` +
                    `- [Matched]:      [${colors.green(ret.n)}],\n` +
                    `- [Successful]:   [${colors.green(ret.ok)}],\n` +
                    `- [DeletedCount]: [${colors.green(ret.deletedCount)}]`;
                    Log('DEBUG', `${action}`);
                }
                return latest.blockNumber;
            } else {
                throw new Error(`Need to reset DB! (latest < defaultblock)`);
            }
        }
    } catch(error) {
        let action = `Action: getStartBlock`;
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
        return 0;
    }
}

/**
 * @notice 이벤트 로그 파싱을 위한 테이블을 생성한다.
 * @return 이벤트 로그 파싱 테이블 (Object)
 * @author jhhong
 */
let createEventParseTable = async function() {
    try {
        let ret = new Array(); // 결과 테이블
        for(let i = 0; i < abiToken.length; i++) {
            if(abiToken[i].type == 'event') {
                let proto = `${abiToken[i].name}(`; // 이벤트 시그니처를 계산하기 위한 이벤트 프로토타입
                for(let j = 0; j < abiToken[i].inputs.length; j++) {
                    proto += (j == 0)? (`${abiToken[i].inputs[j].type}`) : (`,${abiToken[i].inputs[j].type}`);
                }
                proto += `)`;
                let sigret = await web3.eth.abi.encodeEventSignature(proto); // 이벤트 프로토타입에서 이벤트 시그니처를 추출한다.
                let obj = new Object();
                obj.name = abiToken[i].name; // 이벤트 이름
                obj.inputs = abiToken[i].inputs; // 이벤트 input 파라메터, 이벤트 파싱 시 호출되는 decodeLog의 파라메터로 필요한 값
                obj.signature = sigret; // 이벤트 시그니처, receipt의 logs.topics에 담겨오는 이벤트 식별자이다.
                ret.push(obj);
            }
        }
        return (ret.length > 0)? (ret) : (null);
    } catch(error) {
        Log('ERROR', `${colors.red(error)}`);
        usage();
        process.exit(1);
    }
}

/**
 * @notice 이벤트의 아규먼트 정보를 획득한다.
 * @param {String} eventname 이벤트 이름
 * @param {Object} table EventLog Parsing 테이블
 * @param {Object} receipt getTransactionReceipt 결과물
 * @author jhhong
 */
let getEventArguments = async function(eventname, table, receipt) {
    try {
        let elmt = undefined;
        for(let i = 0; i < table.length; i++) {
            if(table[i].name == eventname) {
                elmt = table[i]; // eventname에 해당하는 table elmt 획득
                break;
            }
        }
        if(elmt != undefined) { // 매칭되는 table elmt가 존재할 경우
            for(let i = 0; i < receipt.logs.length; i++) {
                if(receipt.logs[i].topics[0] == elmt.signature) { // eventname에 해당하는 event log가 있다면
                    let data = receipt.logs[i].data; // receipt에서 data 추출
                    let topics = receipt.logs[i].topics.slice(1); // receipt에서 topics 추출
                    return await web3.eth.abi.decodeLog(elmt.inputs, data, topics); // 아규먼트 정보 획득
                }
            }
        }
        return null;
    } catch(error) {
        Log('ERROR', `${colors.red(error)}`);
        return null;
    }
}

/**
 * @notice deoloy 트랜젝션을 처리하는 프로시져이다.
 * @param {String} prefix 컨트랙트 PREFIX (token)
 * @param {Object} receipt getTransactionReceipt 결과물
 * @param {Object} item mongoose DB에 추가될 item
 * @author jhhong
 */
let procTxDeploy = async function(prefix, receipt, item) {
    try {
        if(await isDkargoContract(receipt.contractAddress) == true && prefix == 'token') {
            item.tokenAddr = receipt.contractAddress.toLowerCase(); // DEPLOYED: 토큰 컨트랙트 주소
            item.deployedType = prefix; // deploy 컨트랙트 타입: token만 허용
            item.creator = receipt.from; // 트랜젝션 생성자 주소 (deploy를 수행한 EOA == receipt.from)
            item.txtype = 'deploy';
            await TxToken.collection.insertOne(item);
        }
    } catch(error) {
        Log('ERROR', `${colors.red(error)}`);
    }
}

/**
 * @notice Token 컨트랙트 관련 트랜젝션을 처리하는 프로시져이다.
 * @dev register / settle / unregister / markOrderPayed
 * @param {Object} table EventLog Parsing 테이블 (이벤트 이름 / inputs / signature 조합)
 * @param {Object} txdata getTransaction 결과물
 * @param {Object} receipt getTransactionReceipt 결과물
 * @param {Object} item mongoose DB에 추가될 item
 * @author jhhong
 */
let procTxToken = async function(table, txdata, receipt, item) {
    try {
        const selector = txdata.input.substr(0, 10);
        switch(selector) {
        case '0xa9059cbb':   // "transfer(address,uint256)"
        case '0x23b872dd': { // "transferFrom(address,address,uint256)"
            let ret = await getEventArguments('Transfer', table, receipt); // 이벤트 파라메터 획득
            item.origin = ret.from; // 토큰 송신 계좌주소
            item.dest = ret.to; // 토큰 수신 계좌주소
            item.amount = ret.value; // 토큰 전송량
            item.txtype = 'transfer'; // txtype: transfer
            await TxToken.collection.insertOne(item);
            break;
        }
        case '0x42966c68': { // "burn(uint256)"
            let ret = await getEventArguments('Transfer', table, receipt); // 이벤트 파라메터 획득
            item.origin = ret.from; // 토큰 소각 계좌주소
            item.amount = ret.value; // 토큰 소각량
            item.txtype = 'burn'; // txtype: burn
            await TxToken.collection.insertOne(item);
            break;
        }
        case '0x095ea7b3': { // "approve(address,uint256)"
            let ret = await getEventArguments('Approval', table, receipt); // 이벤트 파라메터 획득
            item.origin = ret.owner; // 토큰 보유 계좌주소
            item.dest = ret.spender; // 토큰 권한위임 계좌주소
            item.amount = ret.value; // 토큰 권한위임량
            item.txtype = 'approve'; // txtype: approve
            await TxToken.collection.insertOne(item);
            break;
        }
        default:
            break;
        }
    } catch(error) {
        Log('ERROR', `${colors.red(error)}`);
    }
}

/**
 * @notice 트랜젝션을 파싱한다.
 * @dev 트랜젝션이 디카르고 tx인지 판별, 디카르고 tx에 한해서 txtype에 맞는 schema로 데이터를 가공
 * @param {Object} table Event Log Parsing 테이블 (이벤트 이름 / inputs / signature 조합)
 * @param {Object} txdata 트랜젝션 정보 (eth.getTransaction)
 * @param {Object} receipt Receipt 정보 (eth.getTransactionReceipt)
 * @param {String} timestamp 블록 timestamp (Epoch TIme)
 * @author jhhong
 */
let parseTransaction = async function(table, txdata, receipt, timestamp) {
    try {
        if(txdata.input && txdata.input.length > 2) { // 컨트랙트 트랜젝션
            let ca = (txdata.to === null)? (receipt.contractAddress.toLowerCase()) : (txdata.to);
            if(await isDkargoContract(ca) == true) { // 디카르고 컨트랙트인 경우에만 처리
                let prefix = await getDkargoPrefix(ca); // 디카르고 Prefix 획득
                let item = new TxToken(); // Schema Object 생성
                item.hash = txdata.hash.toLowerCase();
                item.from = txdata.from.toLowerCase();
                item.blockNumber = txdata.blockNumber;
                item.gas = txdata.gas;
                item.gasUsed = receipt.gasUsed;
                item.gasPrice = String(txdata.gasPrice);
                item.nonce = txdata.nonce;
                item.status = receipt.status;
                item.timestamp = timestamp;
                item.value = web3.utils.fromWei(txdata.value);
                item.txfee = parseFloat(web3.utils.fromWei(item.gasPrice, 'ether') * item.gasUsed).toFixed(4); // 수수료: 소수점 4자리
                if(txdata.to === null) { // 트랜젝션: deploy
                    await procTxDeploy(prefix, receipt, item);
                } else if(prefix == 'token') {
                    item.to = txdata.to.toLowerCase();
                    await procTxToken(table, txdata, receipt, item);
                }
            }
        }
    } catch(error) {
        Log('ERROR', `${colors.red(error)}`);
        usage();
    }
}

/**
 * @notice 과거의 블록정보에 대한 파싱작업을 수행한다.
 * @param {Number} startblock 스타트 블럭넘버
 * @param {Object} table Event Log Parsing 테이블
 * @author jhhong
 */
let syncPastBlocks = async function(startblock, table) {
    try {
        let curblock = startblock;
        console.log(`latestblock : ${await web3.eth.getBlockNumber()}`)
        console.log(`curblock : ${curblock}`)
        while(await web3.eth.getBlockNumber() >= curblock) {
            let data = await web3.eth.getBlock(curblock, true);
            if(await Block.countDocuments({nettype: 'token'}) == 0) {
                let item = new Block();
                item.nettype = 'token';
                item.blockNumber = data.number;
                await Block.collection.insertOne(item);
            } else {
                await Block.collection.updateOne({nettype: 'token'}, {$set: {blockNumber: data.number}});
            }
            let latest = await Block.findOne({nettype: 'token'});
            Log('DEBUG', `New Block Detected: BLOCK:[${colors.blue(latest.blockNumber)}]`);
            const timestamp = data.timestamp;
            for(idx in data.transactions) {
                const txdata  = data.transactions[idx];
                const receipt = await web3.eth.getTransactionReceipt(txdata.hash);
                await parseTransaction(table, txdata, receipt, timestamp);
            }
            curblock++;
        }
        console.log('done');
    } catch(error) {
        Log('ERROR', `${colors.red(error)}`);
    }
}

/**
 * @notice Event 모니터링 수행 함수
 * @author jhhong
 */
let RunProc = async function() {
    try {
        initLog(); // 로그 초기화
        if(process.argv.length != 4) {
            throw new Error("Invalid Parameters!");
        }
        let startblock = await getStartBlock(process.argv[2], process.argv[3]);
        if(startblock == 0) {
            throw new Error(`Need to reset DB! Exit!`);
        }
        Log('DEBUG', colors.gray(`Start Monitoring from BlockNumber:[${startblock}]`));
        let table = await createEventParseTable();
        await syncPastBlocks(startblock, table);
        /**
         * @notice 새 블록 구독
         * @dev 블록 내의 트랜젝션들 조회 -> 디카르고 TX들만 추출하여 TX TYPE에 맞는 Schema로 가공 후 DB에 저장
         * @author jhhong
         */
        web3.eth.subscribe('newBlockHeaders', async function(error) {
            if(error != null) {
                Log('ERROR', colors.red(`ERROR: ${error}`));
            }
        }).on('data', async (header) => {
            let data = await web3.eth.getBlock(header.hash, true);
            if(await Block.countDocuments() == 0) {
                let item = new Block();
                item.nettype = 'token';
                item.blockNumber = data.number;
                await Block.collection.insertOne(item);
            } else {
                await Block.collection.updateOne({nettype: 'token'}, {$set: {blockNumber: data.number}});
            }
            let latest = await Block.findOne();
            Log('DEBUG', `New Block Detected: BLOCK:[${colors.blue(latest.blockNumber)}]`);
            const timestamp = data.timestamp;
            for(idx in data.transactions) {
                const txdata  = data.transactions[idx];
                const receipt = await web3.eth.getTransactionReceipt(txdata.hash);
                await parseTransaction(table, txdata, receipt, timestamp);
            }
        }).on('error', async (log) => {
            Log('ERROR', colors.red(`ERROR occured: ${log}`));
        });
     } catch(error) {
        Log('ERROR', `${colors.red(error)}`);
        usage();
        process.exit(1);
     }
 }
 RunProc();