/**
 * @file syncLogistics.js
 * @notice Blockchain 내 정보를 동기화한다.
 * @author jhhong
 */

//// WEB3
const web3 = require('../libs/Web3.js').prov2; // web3 provider (물류 관련 contract는 privnet에 올라간다 (prov2))
//// DBs
require('./db.js'); // for mongoose schema import
const mongoose    = require('mongoose');
const Block       = mongoose.model('ExpBlock'); // module.exports
const TxLogistics = mongoose.model('ExpTxLogistics'); // module.exports
const OrderTrack  = mongoose.model('ExpOrderTrack'); // module.exports
const EventLogs   = mongoose.model('ExpEvtLogistics'); // module.exports
//// LOGs
const initLog       = require('../libs/libLog.js').initLog; // 로그 초기화 함수 (winston)
const enableLogFile = require('../libs/libLog.js').enableLogFile; // 로그 파일 출력기능 추가 함수
const Log           = require('../libs/libLog.js').Log; // 로그 출력
//// LOG COLOR (console)
const RED   = require('../libs/libLog.js').consoleRed; // 콘솔 컬러 출력: RED
const GREEN = require('../libs/libLog.js').consoleGreen; // 콘솔 컬러 출력: GREEN
const BLUE  = require('../libs/libLog.js').consoleBlue; // 콘솔 컬러 출력: BLUE
const GRAY  = require('../libs/libLog.js').consoleGray; // 콘솔 컬러 출력: GRAY
//// ABIs
const abiService = require('../build/contracts/DkargoService.json').abi; // 서비스 컨트랙트 ABI
const abiCompany = require('../build/contracts/DkargoCompany.json').abi; // 물류사 컨트랙트 ABI
const abiOrder   = require('../build/contracts/DkargoOrder.json').abi; // 주문 컨트랙트 ABI
//// APIs
const libCompany = require('../libs/libDkargoCompany.js'); // 물류사 컨트랙트 관련 Library
const libOrder   = require('../libs/libDkargoOrder.js'); // 주문 컨트랙트 관련 Library
const libCommon  = require('../libs/libCommon.js'); // Common Library

/**
 * @notice 블록에 service 컨트랙트가 실제로 존재하는지 확인한다.
 * @param {String} addr    service 컨트랙트 주소
 * @param {Number} genesis service 컨트랙트가 deploy된 블록넘버
 * @return boolean (true: 존재함, false: 존재하지 않음)
 * @author jhhong
 */
let checkValidGenesis = async function(addr, genesis) {
    try {
        let data = await web3.eth.getBlock(genesis, true); // 제네시스 블록의 블록정보를 읽어옴
        if(data == null) {
            throw new Error(`null data received!`);
        }
        Log('DEBUG', `block: [${GREEN(data.number)}] txnum: [${GREEN(data.transactions.length)}]`);
        for(d in data.transactions) {
            const txdata = data.transactions[d];
            const receipt = await web3.eth.getTransactionReceipt(txdata.hash);
            if(txdata.input && txdata.input.length > 2 && txdata.to === null) { // CONTRACT DEPLOY를 수행하는 TX
                let ca = receipt.contractAddress.toLowerCase();
                if(ca == addr.toLowerCase() && await libCommon.isDkargoContract(ca) == true) { // 해당 컨트랙트(ca)가 디카르고 컨트랙트 증명을 위한 인터페이스를 지원함
                    let prefix = await libCommon.getDkargoPrefix(ca); // 해당 컨트랙트(ca)의 prefix를 읽어옴
                    if(prefix == 'service') {
                        return true;
                    }
                }
            }
        }
        return false;
    } catch(error) {
        let action = `Action: checkValidGenesis`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return false;
    }
}

/**
 * @notice 모니터링 시작 블록넘버를 구한다.
 * @param {String} addr         service 컨트랙트 주소
 * @param {Number} defaultblock service 컨트랙트가 deploy된 블록넘버 (process.argv[3])
 * @return 모니터링 시작 블록넘버(Number)
 * @author jhhong
 */
let getStartBlock = async function(addr, defaultblock) {
    try {
        if(await checkValidGenesis(addr, defaultblock) == false) { // 파라메터 validation 체크
            throw new Error(`Invalid Genesis! BlockNumber: [${defaultblock}]`);
        }
        if(await Block.countDocuments({nettype: 'logistics'}) == 0) {
            if(await TxLogistics.countDocuments() == 0 && await OrderTrack.countDocuments() == 0) { // DB에 저장된 내용이 없는 최초상태
                return defaultblock;
            } else {
                throw new Error(`Need to reset DB! (Work schema exist)`);
            }
        } else { // genesis block을 마지막 처리된 blockNumber로 설정
            let latest = await Block.findOne();
            if(latest.blockNumber >= defaultblock) { // 마지막 처리된 이벤트 내용을 Work Schema에서 삭제 (중복저장 방지)
                let ret = await TxLogistics.deleteMany({blocknumber: latest.blockNumber});
                if(ret != null) {
                    let action = `Delete done! (TxLogistics) count:[${GREEN(ret.deletedCount)}]`;
                    Log('DEBUG', `${action}`);
                }
                ret = await OrderTrack.deleteMany({blocknumber: latest.blockNumber});
                if(ret != null) {
                    let action = `Delete done! (OrderTrack) count:[${GREEN(ret.deletedCount)}]`;
                    Log('DEBUG', `${action}`);
                }
                return latest.blockNumber;
            } else {
                throw new Error(`Need to reset DB! (latest < defaultblock)`);
            }
        }
    } catch(error) {
        let action = `Action: getStartBlock`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
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
        for(let i = 0; i < abiService.length; i++) {
            if(abiService[i].type == 'event') {
                let proto = `${abiService[i].name}(`; // 이벤트 시그니처를 계산하기 위한 이벤트 프로토타입
                for(let j = 0; j < abiService[i].inputs.length; j++) {
                    proto += (j == 0)? (`${abiService[i].inputs[j].type}`) : (`,${abiService[i].inputs[j].type}`);
                }
                proto += `)`;
                let sigret = await web3.eth.abi.encodeEventSignature(proto); // 이벤트 프로토타입에서 이벤트 시그니처를 추출한다.
                let obj = new Object();
                obj.name = abiService[i].name; // 이벤트 이름
                obj.inputs = abiService[i].inputs; // 이벤트 input 파라메터, 이벤트 파싱 시 호출되는 decodeLog의 파라메터로 필요한 값
                obj.signature = sigret; // 이벤트 시그니처, receipt의 logs.topics에 담겨오는 이벤트 식별자이다.
                ret.push(obj);
            }
        }
        for(let i = 0; i < abiCompany.length; i++) {
            if(abiCompany[i].type == 'event') {
                let proto = `${abiCompany[i].name}(`; // 이벤트 시그니처를 계산하기 위한 이벤트 프로토타입
                for(let j = 0; j < abiCompany[i].inputs.length; j++) {
                    proto += (j == 0)? (`${abiCompany[i].inputs[j].type}`) : (`,${abiCompany[i].inputs[j].type}`);
                }
                proto += `)`;
                let sigret = await web3.eth.abi.encodeEventSignature(proto); // 이벤트 프로토타입에서 이벤트 시그니처를 추출한다.
                let obj = new Object();
                obj.name = abiCompany[i].name; // 이벤트 이름
                obj.inputs = abiCompany[i].inputs; // 이벤트 input 파라메터, 이벤트 파싱 시 호출되는 decodeLog의 파라메터로 필요한 값
                obj.signature = sigret; // 이벤트 시그니처, receipt의 logs.topics에 담겨오는 이벤트 식별자이다.
                ret.push(obj);
            }
        }
        for(let i = 0; i < abiOrder.length; i++) {
            if(abiOrder[i].type == 'event') {
                let proto = `${abiOrder[i].name}(`; // 이벤트 시그니처를 계산하기 위한 이벤트 프로토타입
                for(let j = 0; j < abiOrder[i].inputs.length; j++) {
                    proto += (j == 0)? (`${abiOrder[i].inputs[j].type}`) : (`,${abiOrder[i].inputs[j].type}`);
                }
                proto += `)`;
                let sigret = await web3.eth.abi.encodeEventSignature(proto); // 이벤트 프로토타입에서 이벤트 시그니처를 추출한다.
                let obj = new Object();
                obj.name = abiOrder[i].name; // 이벤트 이름
                obj.inputs = abiOrder[i].inputs; // 이벤트 input 파라메터, 이벤트 파싱 시 호출되는 decodeLog의 파라메터로 필요한 값
                obj.signature = sigret; // 이벤트 시그니처, receipt의 logs.topics에 담겨오는 이벤트 식별자이다.
                ret.push(obj);
            }
        }
        return (ret.length > 0)? (ret) : (null);
    } catch(error) {
        Log('ERROR', `${RED(error)}`);
        return null;
    }
}

/**
 * @notice 트랜젝션 안의 모든 이벤트로그들의 정보를 획득한다.
 * @param {Object} receipt getTransactionReceipt 결과물
 * @param {Object} table   EventLog Parsing 테이블
 * @return 트랜젝션 안의 모든 이벤트로그들의 정보 (배열)
 * @author jhhong
 */
let getEventLogs = async function(receipt, table) {
    try {
        let eventLogs = new Array(); // 트랜젝션 안의 모든 이벤트로그들의 정보를 담을 배열
        for(let i = 0; i < receipt.logs.length; i++) {
            for(let j = 0; j < table.length; j++) {
                if(receipt.logs[i].topics[0] == table[j].signature) { // eventname에 해당하는 event log가 있다면
                    let eventLog = new Object();
                    eventLog.name =table[j].name;
                    let data = receipt.logs[i].data; // receipt에서 data 추출
                    let topics = receipt.logs[i].topics.slice(1); // receipt에서 topics 추출
                    let ret = await web3.eth.abi.decodeLog(table[j].inputs, data, topics); // 아규먼트 정보 획득
                    eventLog.ret = ret;
                    eventLogs.push(eventLog);
                    let item = new EventLogs(); // Schema Object 생성
                    item.txHash = receipt.transactionHash;
                    item.eventName = table[j].name;
                    item.paramCount = ret.__length__;
                    switch(ret.__length__) {
                    case 4:
                        item.paramData04 = ret[3];
                        item.paramType04 = table[j].inputs[3].type;
                        item.paramName04 = table[j].inputs[3].name;
                    case 3:
                        item.paramData03 = ret[2];
                        item.paramType03 = table[j].inputs[2].type;
                        item.paramName03 = table[j].inputs[2].name;
                    case 2:
                        item.paramData02 = ret[1];
                        item.paramType02 = table[j].inputs[1].type;
                        item.paramName02 = table[j].inputs[1].name;
                    case 1:
                        item.paramData01 = ret[0];
                        item.paramType01 = table[j].inputs[0].type;
                        item.paramName01 = table[j].inputs[0].name;
                    default:
                        break;
                    }
                    await EventLogs.collection.insertOne(item); // 이벤트 로그 DB에 저장
                }
            }
        }
        return eventLogs;
    } catch(error) {
        Log('ERROR', `${RED(error)}`);
        return null;
    }
}

/**
 * @notice Service 컨트랙트 관련 트랜젝션을 처리하는 프로시져이다.
 * @dev DEPLOY: DEPLOY 트랜젝션 처리
 * @dev REGISTER: 물류사 등록 트랜젝션 처리
 * @dev UNREGISTER: 물류사 등록해제 트랜젝션 처리
 * @dev SETTLE: 인센티브 정산 트랜젝션 처리
 * @param {Object} receipt   getTransactionReceipt 결과물
 * @param {String} inputs    트랜젝션 INPUT DATA (HEXA-STRING)
 * @param {Object} eventLogs 트랜젝션의 이벤트 로그 파싱 결과물
 * @param {Object} item      DB에 저장할 트랜젝션 파싱 결과물
 * @author jhhong
 */
let procTxService = async function(receipt, inputs, eventLogs, item) {
    try {
        if(inputs == null) { // 트랜젝션: DEPLOY
            item.serviceAddr = receipt.contractAddress.toLowerCase(); // DEPLOYED: 서비스 컨트랙트 주소
            item.deployedType = 'service'; // DEPLOYED 컨트랙트 타입
            item.txtype = 'DEPLOY';
            await TxLogistics.collection.insertOne(item); // 물류 트랜젝션 정보 DB에 저장
        } else {
            const selector = inputs.substr(0, 10);
            switch(selector) { // 트랜젝션: NON-DEPLOY
            case '0x4420e486': { // "register(address)"
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'CompanyRegistered') {
                        item.companyName = await libCompany.name(eventLogs[i].ret.company); // 물류사 컨트랙트 주소로 물류사 이름 획득
                        item.companyAddr = eventLogs[i].ret.company; // 물류사 컨트랙트 주소
                        item.txtype = 'REGISTER';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            case '0x2ec2c246': { // "unregister(address)"
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'CompanyUnregistered') {
                        item.companyName = await libCompany.name(eventLogs[i].ret.company); // 물류사 컨트랙트 주소로 물류사 이름 획득
                        item.companyAddr = eventLogs[i].ret.company; // 물류사 컨트랙트 주소
                        item.txtype = 'UNREGISTER';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            case '0x6a256b29': { // "settle(address)"
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'Settled') {
                        item.recipient = eventLogs[i].ret.addr.toLowerCase();
                        item.param01 = eventLogs[i].ret.value;
                        item.param02 = eventLogs[i].ret.rests;
                        item.txtype = 'SETTLEMENT';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            default:
                break;
            }
        }
    } catch(error) {
        Log('ERROR', `${RED(error)}`);
    }
}

/**
 * @notice Company 컨트랙트 관련 트랜젝션을 처리하는 프로시져이다.
 * @dev ORDER-LAUNCH: 주문 접수 트랜젝션 처리
 * @dev ORDER-UPDATE: 주문 상태갱신 트랜젝션 처리
 * @dev MANAGEMENT (addOperator): 물류사-운용자 등록 트랜젝션 처리
 * @dev MANAGEMENT (removeOperator): 물류사-운용자 등록해제 트랜젝션 처리
 * @dev MANAGEMENT (setName): 물류사 이름 변경 트랜젝션 처리
 * @dev MANAGEMENT (setUrl): 물류사 URL 변경 트랜젝션 처리
 * @dev MANAGEMENT (setRecipient): 물류사 수취인주소 변경 트랜젝션 처리
 * @param {Object} receipt   getTransactionReceipt 결과물
 * @param {String} inputs    트랜젝션 INPUT DATA (HEXA-STRING)
 * @param {Object} eventLogs 트랜젝션의 이벤트 로그 파싱 결과물
 * @param {Object} item      DB에 저장할 트랜젝션 파싱 결과물
 * @author jhhong
 */
let procTxCompany = async function(receipt, inputs, eventLogs, item) {
    try {
        if(inputs == null) { // 트랜젝션: DEPLOY
            item.companyAddr = receipt.contractAddress.toLowerCase(); // DEPLOYED: 물류사 컨트랙트 주소
            item.deployedType = 'company'; // DEPLOYED 컨트랙트 타입
            item.txtype = 'DEPLOY';
            await TxLogistics.collection.insertOne(item); // 물류 트랜젝션 정보 DB에 저장
        } else {
            const selector = inputs.substr(0, 10);
            switch(selector) {
            case '0xedfb6516': { // "launch(address,uint256)"
                item.orderAddr = `0x${inputs.substring(34, 74)}`; // inputs에서 주문 컨트랙트 주소 추출
                item.orderId = await libOrder.orderid(item.orderAddr); // 주문 컨트랙트 주소로 주문번호 획득
                item.companyAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.companyName = await libCompany.name(item.companyAddr); // 물류사 컨트랙트 주소로 물류사 이름 획득
                item.transportId = parseInt(`0x${inputs.substring(74, 138)}`).toString(10); // inputs에서 운송번호 추출
                item.txtype = 'ORDER-LAUNCH';
                await TxLogistics.collection.insertOne(item);
                break;
            }
            case '0xe50097a9': { // "updateOrderCode(address,uint256,uint256)"
                item.orderAddr = `0x${inputs.substring(34, 74)}`; // inputs에서 주문 컨트랙트 주소 추출
                item.orderId = await libOrder.orderid(item.orderAddr); // 주문 컨트랙트 주소로 주문번호 획득
                item.companyAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.companyName = await libCompany.name(item.companyAddr); // 물류사 컨트랙트 주소로 물류사 이름 획득
                item.transportId = parseInt(`0x${inputs.substring(74, 138)}`).toString(10); // inputs에서 운송번호 추출
                item.code = parseInt(`0x${inputs.substring(138, 202)}`).toString(10); // inputs에서 배송코드 추출
                item.txtype = 'ORDER-UPDATE';
                await OrderTrack.collection.updateOne({$and: [{orderAddr: item.orderAddr}, {code: item.code}]}, {$set: {txhash: item.hash}});
                await TxLogistics.collection.insertOne(item);
                break;
            }
            case '0x9870d7fe': { // "addOperator(address)"
                item.companyAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.companyName = await libCompany.name(item.companyAddr); // 물류사 컨트랙트 주소로 물류사 이름 획득
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'OperatorAdded') {
                        item.param01 = eventLogs[i].ret.account; // 등록될 운영자 주소
                        item.txtype = 'addOperator';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            case '0xac8a584a': { // "removeOperator(address)"
                item.companyAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.companyName = await libCompany.name(item.companyAddr); // 물류사 컨트랙트 주소로 물류사 이름 획득
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'OperatorRemoved') {
                        item.param01 = eventLogs[i].ret.account; // 등록될 운영자 주소
                        item.txtype = 'removeOperator';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            case '0xc47f0027': { // "setName(string)"
                item.companyAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.companyName = await libCompany.name(item.companyAddr); // 물류사 컨트랙트 주소로 물류사 이름 획득
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'CompanyNameSet') {
                        item.param01 = eventLogs[i].ret.oldName; // 물류사 기존 이름
                        item.param02 = eventLogs[i].ret.newName; // 물류사 새로운 이름
                        item.txtype = 'setName';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            case '0x252498a2': { // "setUrl(string)"
                item.companyAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.companyName = await libCompany.name(item.companyAddr); // 물류사 컨트랙트 주소로 물류사 이름 획득
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'CompanyUrlSet') {
                        item.param01 = eventLogs[i].ret.oldUrl; // 물류사 기존 URL
                        item.param02 = eventLogs[i].ret.newUrl; // 물류사 새로운 URL
                        item.txtype = 'setUrl';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            case '0x3bbed4a0': { // "setRecipient(address)"
                item.companyAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.companyName = await libCompany.name(item.companyAddr); // 물류사 컨트랙트 주소로 물류사 이름 획득
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'CompanyRecipientSet') {
                        item.param01 = eventLogs[i].ret.oldRecipient; // 물류사 기존 수취인주소
                        item.param02 = eventLogs[i].ret.oldRecipient; // 물류사 새로운 수취인주소
                        item.txtype = 'setRecipient';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            default:
                break;
            }
        }
    } catch(error) {
        Log('ERROR', `${RED(error)}`);
    }
}

/**
 * @notice Order 컨트랙트 관련 트랜젝션을 처리하는 프로시져이다.
 * @dev SUBMIT: DEPLOY 트랜젝션 처리
 * @dev MANAGEMENT (setUrl): 주문 상세URL 변경 트랜젝션 처리
 * @param {Object} receipt   getTransactionReceipt 결과물
 * @param {String} inputs    트랜젝션 INPUT DATA (HEXA-STRING)
 * @param {Object} eventLogs 트랜젝션의 이벤트 로그 파싱 결과물
 * @param {Object} item      DB에 저장할 트랜젝션 파싱 결과물
 * @author jhhong
 */
let procTxOrder = async function(receipt, inputs, eventLogs, item) {
    try {
        if(inputs == null) { // 트랜젝션: DEPLOY
            item.orderAddr = receipt.contractAddress.toLowerCase(); // DEPLOYED: 주문 컨트랙트 주소
            item.deployedType = 'order'; // DEPLOYED 컨트랙트 타입
            item.txtype = 'DEPLOY';
            await TxLogistics.collection.insertOne(item); // 물류 트랜젝션 정보 DB에 저장
        } else {
            const selector = inputs.substr(0, 10);
            switch(selector) {
            case '0x786643c0': { // "submitOrderCreate()"
                item.orderAddr = receipt.to.toLowerCase(); // 물류사 컨트랙트 주소
                item.orderId = await libOrder.orderid(item.orderAddr); // 주문 컨트랙트 주소로 주문번호 획득
                item.txtype = 'SUBMIT';
                await TxLogistics.collection.insertOne(item);
                let totalcnt = await libOrder.trackingCount(item.orderAddr); // 총 주문구간 갯수
                for(let idx = 0; idx < totalcnt; idx++) {
                    let track = new OrderTrack();
                    track.blockNumber = receipt.blockNumber; // 블록넘버
                    track.orderAddr = item.orderAddr; // 주문 컨트랙트 주소
                    track.orderId = item.orderId; // 주문번호
                    let trackinfo = await libOrder.tracking(item.orderAddr, idx); // 주문 구간정보
                    track.companyAddr = trackinfo[1].toLowerCase(); // 담당자 주소(화주 or 물류사)
                    track.code = trackinfo[2]; // 물류 배송코드
                    track.incentives = trackinfo[3]; // 인센티브 정보
                    track.transportId = idx; // 운송번호
                    if(idx > 0) { // idx=0은 화주, 물류사가 아니므로 물류사 이름을 기록하지 않음
                        track.companyName = await libCompany.name(trackinfo[1]); // 물류사 이름
                    } else if(idx == 0) {
                        track.txhash = item.hash; // 배송코드 10(주문생성)에 해당하는 txhash 기록
                    }
                    await OrderTrack.collection.insertOne(track); // 구간정보 DB에 저장
                }
                break;
            }
            case '0x252498a2': { // "setUrl(string)"
                item.orderAddr = receipt.to.toLowerCase(); // 주문 컨트랙트 주소
                item.orderId = await libOrder.orderid(item.orderAddr); // 주문 컨트랙트 주소로 주문번호 획득
                for(let i = 0; i < eventLogs.length; i++) {
                    if(eventLogs[i].name == 'OrderUrlSet') {
                        item.param01 = eventLogs[i].ret.oldUrl; // 물류사 기존 URL
                        item.param02 = eventLogs[i].ret.newUrl; // 물류사 새로운 URL
                        item.txtype = 'setOrderUrl';
                        await TxLogistics.collection.insertOne(item);
                        break;
                    }
                }
                break;
            }
            default:
                break;
            }
        }
    } catch(error) {
        Log('ERROR', `${RED(error)}`);
    }
}

/**
 * @notice 디카르고 트랜젝션을 파싱한다.
 * @dev 디카르고 플랫폼에서 만든 트랜젝션인지 판별하여 데이터 파싱
 * @param {Object} txdata    트랜젝션 정보 (eth.getTransaction)
 * @param {Object} table     Event Log Parsing 테이블 (이벤트 이름 / inputs / signature 조합)
 * @param {String} timestamp 블록 timestamp (Epoch TIme)
 * @author jhhong
 */
let parseDkargoTxns = async function(txdata, table, timestamp) {
    try {
        if(txdata.input && txdata.input.length > 2) { // 컨트랙트 트랜젝션
            const receipt = await web3.eth.getTransactionReceipt(txdata.hash);
            let ca = (txdata.to === null)? (receipt.contractAddress.toLowerCase()) : (txdata.to.toLowerCase());
            if(await libCommon.isDkargoContract(ca) == true) { // 디카르고 컨트랙트인 경우에만 처리
                let funcTable = {}; // Dictionary 변수 선언 (PREFIX-FUNCTION MAPPER)
                funcTable['service'] = procTxService; // 처리담당 함수 지정 'service'
                funcTable['company'] = procTxCompany; // 처리담당 함수 지정 'company'
                funcTable['order']   = procTxOrder;   // 처리담당 함수 지정 'order'
                let prefix = await libCommon.getDkargoPrefix(ca); // 디카르고 PREFIX 획득
                if(funcTable[prefix] != undefined) {
                    let item = new TxLogistics(); // Schema Object 생성
                    item.hash = txdata.hash.toLowerCase();
                    item.from = txdata.from.toLowerCase();
                    if(txdata.to !== null) {
                        item.to = txdata.to.toLowerCase(); // Bugfix: Blockchain Info에 To 넣음
                    }
                    item.blockNumber = txdata.blockNumber;
                    item.gas = txdata.gas;
                    item.gasUsed = receipt.gasUsed;
                    item.gasPrice = String(txdata.gasPrice);
                    item.nonce = txdata.nonce;
                    item.status = (receipt.status == true)? ('Success') : ('Failed');
                    item.timestamp = timestamp;
                    item.value = web3.utils.fromWei(txdata.value);
                    item.txfee = parseFloat(web3.utils.fromWei(item.gasPrice, 'ether') * item.gasUsed).toFixed(8); // 수수료: 소수점 8자리
                    let inputs = (txdata.to === null)? (null) : (txdata.input); // DEPLOY TX의 INPUT Data 크기가 너무 방대하여 param으로 넘기기에 Overhead가 큼
                    let eventLogs = await getEventLogs(receipt, table);
                    await funcTable[prefix](receipt, inputs, eventLogs, item);
                }
            }
        }
    } catch(error) {
        Log('ERROR', `${RED(error)}`);
    }
}

/**
 * @notice 과거의 블록정보에 대한 파싱작업을 수행한다.
 * @param {Number} startblock 스타트 블럭넘버
 * @param {Object} table      Event Log Parsing 테이블
 * @author jhhong
 */
let syncPastBlocks = async function(startblock, table) {
    try {
        let curblock = startblock;
        while(await web3.eth.getBlockNumber() >= curblock) {
            let data = await web3.eth.getBlock(curblock, true);
            if(await Block.countDocuments({nettype: 'logistics'}) == 0) {
                let item = new Block();
                item.nettype = 'logistics';
                item.blockNumber = data.number;
                await Block.collection.insertOne(item);
            } else {
                await Block.collection.updateOne({nettype: 'logistics'}, {$set: {blockNumber: data.number}});
            }
            /*let latest = await Block.findOne({nettype: 'logistics'});
            Log('DEBUG', `New Block Detected: BLOCK:[${BLUE(latest.blockNumber)}]`);*/
            const timestamp = data.timestamp;
            for(idx in data.transactions) {
                await parseDkargoTxns(data.transactions[idx], table, timestamp);
            }
            curblock++;
        }
        Log('INFO', `START BLOCK:[${curblock}]`);
    } catch(error) {
        Log('ERROR', `${RED(error)}`);
    }
}

/**
 * @notice 사용법 출력함수이다.
 * @author jhhong
 */
function usage() {
    const fullpath = __filename.split('/');
    const filename = fullpath[fullpath.length - 1];
    console.log(GREEN("Usage:"));
    console.log(`> node ${filename} [argv1] [argv2]`);
    console.log(`....[argv1]: Service Address`);
    console.log(`....[argv2]: Start Block`);
}

/**
 * @notice Event 모니터링 수행 함수
 * @author jhhong
 */
let RunProc = async function() {
    try {
        await initLog(); // 로그 초기화
        await enableLogFile(`explorer/syncLogistics`);
        if(process.argv.length != 4) {
            throw new Error("Invalid Parameters!");
        }
        let startblock = await getStartBlock(process.argv[2], process.argv[3]);
        if(startblock == 0) {
            throw new Error(`Need to reset DB! Exit!`);
        }
        Log('DEBUG', GRAY(`Start Monitoring from BlockNumber:[${startblock}]......`));
        let table = await createEventParseTable();
        if (table == null) {
            throw new Error("\"EVENT TABLE\" create Failed!");
        }
        await syncPastBlocks(startblock, table);
        /**
         * @notice 새 블록 구독
         * @dev 블록 내의 트랜젝션들 조회 -> 디카르고 TX들만 추출하여 TX TYPE에 맞는 Schema로 가공 후 DB에 저장
         * @author jhhong
         */
        web3.eth.subscribe('newBlockHeaders', async function(error) {
            if(error != null) {
                Log('ERROR', RED(`ERROR: ${error}`));
            }
        }).on('data', async (header) => {
            let data = await web3.eth.getBlock(header.hash, true);
            if(await Block.countDocuments() == 0) {
                let item = new Block();
                item.nettype = 'logistics';
                item.blockNumber = data.number;
                await Block.collection.insertOne(item);
            } else {
                await Block.collection.updateOne({nettype: 'logistics'}, {$set: {blockNumber: data.number}});
            }
            let latest = await Block.findOne();
            //Log('DEBUG', `New Block Detected: BLOCK:[${BLUE(latest.blockNumber)}]`);
            const timestamp = data.timestamp;
            for(idx in data.transactions) {
                const txdata  = data.transactions[idx];
                await parseDkargoTxns(txdata, table, timestamp);
            }
        }).on('error', async (log) => {
            Log('ERROR', RED(`ERROR occured: ${log}`));
        });
     } catch(error) {
        Log('ERROR', `${RED(error)}`);
        usage();
        process.exit(1);
     }
 }
 RunProc();