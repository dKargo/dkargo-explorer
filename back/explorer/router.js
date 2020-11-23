/**
 * @file router.js
 * @notice EXPLORER REQUEST 처리 라우팅 기능 담당
 * @author jhhong
 */

//// COMMON
const path = require('path'); // .env 경로 추출을 위함
//// CONSTANTS
const ZEROADDR  = require('../libs/libCommon.js').ZEROADDR; // ZERO-ADDRESS 상수
//// DBs
require('./db.js'); // for mongoose schema import
const mongoose     = require('mongoose');
const TxLogistics  = mongoose.model('ExpTxLogistics'); // module.exports
const TxToken      = mongoose.model('ExpTxToken'); // module.exports
const OrderTrack   = mongoose.model('ExpOrderTrack'); // module.exports
const EvtLogistics = mongoose.model('ExpEvtLogistics'); // module.exports
const EvtToken     = mongoose.model('ExpEvtToken'); // module.exports
//// WEB3
const web3 = require('../libs/Web3.js').prov2; // 물류 관련 provider
//// LOGs
const Log = require('../libs/libLog.js').Log; // 로그 출력
//// LOG COLOR (console)
const RED = require('../libs/libLog.js').consoleRed; // 콘솔 컬러 출력: RED
//// DOTENV
require('dotenv').config({ path: path.join(__dirname, '../.env') }); // 지정된 경로의 환경변수 사용 (.env 파일 참조)
//// APIs & LIBs
const libService = require('../libs/libDkargoService.js'); // 서비스 컨트랙트 관련 Library
const libCompany = require('../libs/libDkargoCompany.js'); // 물류사 컨트랙트 관련 Library
const libOrder   = require('../libs/libDkargoOrder.js'); // 주문 컨트랙트 관련 Library
const libToken   = require('../libs/libDkargoToken.js'); // 토큰 컨트랙트 관련 Library
const libCommon  = require('../libs/libCommon.js'); // Common Library

/**
 * @notice 주소의 타입을 확인한다.
 * @dev Supported Type: company / order / eoa
 * @param {String} addr 타입을 확인할 주소
 * @return 정상 처리시 type string, 오류 발생시 null
 * @author jhhong
 */
let getAddressType = async function(addr) {
    try {
        let type = 'eoa';
        if(await web3.eth.getCode(addr) > 3) { // CA (EOA 판정조건--> geth: 0x, ganache: 0x0)
            if(await libCommon.isDkargoContract(addr) == true) {
                switch(await libCommon.getDkargoPrefix(addr)) {
                case 'order':
                    type = 'order';
                    break;
                case 'company':
                    type = 'company';
                    break;
                default:
                    break;
                }
            }
        }
        return type;
    } catch(error) {
        let action = `Action: getAddressType`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return null;
    }
}

/**
 * @notice 주문 상태를 반환한다.
 * @param {String} addr        주문 컨트랙트 주소
 * @param {String} transportId 물류사 담당 운송번호 (주문의 현재 STEP값과 비교하여 물류사가 현재 주문을 착수하였는지의 여부를 판별)
 * @return 주문 상태(String: success/fail/proceeding/error)
 * @author jhhong
 */
let getOrderStatus = async function(addr, transportId) {
    try {
        if(await libOrder.isComplete(addr) == true) {
            return 'Complete';
        } else if(await libOrder.isFailed(addr) == true) {
            return 'Failed';
        } else {
            let curstep = await libOrder.currentStep(addr);
            if(curstep < transportId) {
                return 'Not Started';
            } else if(curstep == transportId) {
                return 'Proceeding';
            } else {
                return 'Complete';
            }
        }
    } catch(error) {
        let action = `Action: getOrderStatus`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return 'error';
    }
}

/**
 * @notice RESTFUL의 응답으로 가공될 TX TYPE을 반환한다.
 * @param {String} txtype DB에 저장된 트랜젝션 정보
 * @return RESTFUL의 응답으로 가공될 TX TYPE (STRING)
 * @author jhhong
 */
let getTxType = async function(txtype) {
    try {
        switch(txtype) {
        case 'addOperator':      // 물류사의 운영자 등록
        case 'removeOperator':   // 물류사의 운영자 등록해제
        case 'setName':          // 물류사 네이밍 변경
        case 'setUrl':           // 물류사 홈페이지 URL 변경
        case 'setRecipient':     // 물류사 수취인주소 변경
        case 'setOrderUrl':      // 주문 상세정보 URL 변경
            return 'MANAGEMENT';
        case 'REGISTER':         // 물류사를 디카르고 플랫폼에 등록
        case 'UNREGISTER':       // 물류사를 디카르고 플랫폼에서 등록해제
        case 'SETTLEMENT':       // 인센티브 정산
        case 'ORDER-LAUNCH':     // 물류사의 주문접수
        case 'ORDER-UPDATE':     // 물류사의 주문상태 갱신
        case 'SUBMIT':           // 주문 등록요청
        case 'TRANSFER':         // 토큰 전송
        case 'BURN':             // 토큰 소각
        case 'APPROVE':          // 토큰 위임
        case 'DEPLOY':           // 컨트랙트 Deploy
            return txtype;
        default:
            throw new Error(`Unsupported TX Type!`);
        }
    } catch(error) {
        let action = `Action: getTxType`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return null;
    }
}

/**
 * @notice 계정 정보를 획득한다.
 * @dev 표현 가능 Account 정보: EOA / CA(Company) / CA(Order), 차후 CA(Service)도 추가 예정
 * @param {String} addr    계정 주소
 * @param {Number} page    페이지 인덱스 (page * 25 == 시작 인덱스)
 * @param {String} type    도시할 정보 타입 (logistics / token)
 * @param {String} service 서비스 컨트랙트 주소
 * @param {String} token   토큰 컨트랙트 주소
 * @return 계정 정보 (json), 정보가 없거나 오류발생 시 'none'
 * @author jhhong
 */
let getAccountInfo = async function(addr, page, type, service, token) {
    try {
        if(addr.length !== 42) { // 체크: addr format
            throw new Error(`Invalid Account Format! account: [${addr}]`);
        }
        let addrtype = await getAddressType(addr);
        if(addrtype == null) { // 체크: address type
            throw new Error(`Invalid Address! address: [${addr}]`);
        }
        addr = addr.toLowerCase();
        if(addrtype == 'order') { // Addr이 주문 컨트랙트 주소인 경우
            let servcmp = await libOrder.service(addr); // 물류사에 바인딩된 서비스 컨트랙트 주소 획득하여 param 체크
            if(servcmp != service) {
                throw new Error(`Not Matched Service! param=[${service}] / embedded=[${servcmp}]`);
            }
            let resp = new Object(); // 결과값을 담을 오브젝트
            resp.accountType = 'order';
            let data = new Object();
            data.orderAddress = addr; // 주문 컨트랙트 주소
            data.orderId = await libOrder.orderid(addr); // 주문번호
            data.shipperAddress =(await libOrder.tracking(addr, 0))[1]; // 화주 주소
            data.totalIncentiveAmounts = await libOrder.totalIncentive(addr); // 총 인센티브 합
            data.url = await libOrder.url(addr); // 주문 상세 URL
            data.currentStep = parseInt(await libOrder.currentStep(addr)); // 주문 현재 배송구간 인덱스 (0부터 시작)
            data.trackingCount = await libOrder.trackingCount(addr); // 주문 총 배송구간 갯수
            let tracks = new Array(); // 주문의 각 배송정보를 담을 배열
            for(let idx = 0; idx < data.trackingCount; idx++) {
                let trackinfo = await libOrder.tracking(addr, idx); // 구간별 배송정보
                let elmt = new Object();
                elmt.companyAddress = trackinfo[1]; // 담당자 주소 (화주 or 물류사)
                elmt.status = trackinfo[2]; // 배송 코드
                elmt.type = await getAddressType(elmt.companyAddress); // 주소 타입: ('eoa' / 'company')
                if(elmt.type == 'company') {
                    elmt.companyName = await libCompany.name(elmt.companyAddress); // 물류사 이름
                }
                elmt.incentiveAmounts = trackinfo[3]; // 배송 인센티브
                elmt.completion = await getOrderStatus(data.orderAddress, idx); // 배송 상태
                elmt.txHash = (await OrderTrack.findOne({$and: [{orderAddr: addr}, {code: elmt.status}]})).txhash;
                tracks.push(elmt);
            }
            data.tracking = tracks;
            data.transactionCount = await TxLogistics.countDocuments({orderAddr: addr}); // 주문과 관련된 Tx 총 갯수
            let txs = await TxLogistics.find({orderAddr: addr}).sort('-blockNumber').lean(true).limit(data.logisticsCount);
            let logistics = new Array(); // 주문과 관련된 각 Tx 정보들을 담을 배열
            for(let idx = 0; idx < data.transactionCount; idx++) {
                let elmt = new Object();
                elmt.txHash = txs[idx].hash; // 트랜젝션 해시
                elmt.txStatus = txs[idx].status; // 트랜젝션 상태 (success / fail / pending)
                elmt.blockNumber = txs[idx].blockNumber; // 블록넘버
                elmt.time = txs[idx].timestamp; // timestamp (epoch time)
                elmt.type = await getTxType(txs[idx].txtype); // 트랜젝션 타입
                logistics.push(elmt);
            }
            data.logistics = logistics;
            resp.data = data;
            return JSON.stringify(resp);
        } else if(addrtype == 'company') { // Addr이 물류사 컨트랙트 주소인 경우
            let curpage = (page === undefined)? (1) : (page);
            let curtype = (type === undefined)? ('txs') : (type);
            if(curtype != 'txs' && curtype != 'orders') { // 체크: type
                throw new Error(`Invalid Type! type: [${curtype}]`);
            }
            if(curpage > process.env.MAXPAGES || curpage == 0) { // 체크: page index
                throw new Error(`Out Of Scope Page! page: [${curpage}]`);
            }
            let servcmp = await libCompany.service(addr); // 물류사에 바인딩된 서비스 컨트랙트 주소 획득하여 param 체크
            if(servcmp != service) {
                throw new Error(`Not Matched Service! param=[${service}] / embedded=[${servcmp}]`);
            }
            let data = new Object();
            data.registered = await libService.isMember(service, addr); // 물류사 등록 여부
            data.companyAddress = addr; // 물류사 컨트랙트 주소
            data.companyName = await libCompany.name(addr); // 물류사 이름
            data.recipient = await libCompany.recipient(addr); // 물류사 수취인 주소
            let incenobj = await libService.incentives(service, addr); // 물류사의 누적 인센티브 획득
            data.totalIncentiveAmounts = parseInt(incenobj[0]) + parseInt(incenobj[1]); // 물류사의 누적 인센티브 획득
            data.totalTxCount = await TxLogistics.countDocuments({companyAddr: addr}); // addr과 관련있는 TX 총갯수
            data.totalOrderCount = await OrderTrack.countDocuments({companyAddr: addr}); // 물류사가 담당하는 주문-구간 총 갯수
            data.datatype = type; // 요청타입: txs / orders
            if(curtype == 'txs') {
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.totalTxCount < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.totalTxCount}]`);
                }
                let pageUnit = start + parseInt(process.env.MAXELMT_PERPAGE);
                let end = (data.totalTxCount >= pageUnit)? (pageUnit) : (data.totalTxCount);
                let lists = await TxLogistics.find({companyAddr: addr}).sort('-blockNumber').lean(true).limit(end);
                let txs = new Array(); // TX 요약정보를 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.txHash = lists[idx].hash; // 트랜젝션 해시
                    elmt.txStatus = lists[idx].status; // 트랜젝션 상태 (success / fail / pending)
                    elmt.blockNumber = lists[idx].blockNumber; // 블록넘버
                    elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                    elmt.type = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                    txs.push(elmt);
                }
                data.txs = txs;
            } else { // type == 'orders'
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.totalOrderCount < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.totalOrderCount}]`);
                }
                let pageUnit = start + parseInt(process.env.MAXELMT_PERPAGE);
                let end = (data.totalOrderCount >= pageUnit)? (pageUnit) : (data.totalOrderCount);
                let lists = await OrderTrack.find({companyAddr: addr}).sort({blockNumber: -1, orderId: -1}).lean(true).limit(end);
                let orders = new Array(); // 물류사 담당 주문-구간을 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.address = lists[idx].orderAddr; // 주문 컨트랙트 주소
                    elmt.id = lists[idx].orderId; // 주문 번호
                    elmt.incentiveAmounts = lists[idx].incentives; // 인센티브
                    elmt.status = lists[idx].code; // 배송 코드
                    elmt.completion = await getOrderStatus(lists[idx].orderAddr, lists[idx].transportId); // 배송 상태
                    elmt.txHash = (await OrderTrack.findOne({$and: [{orderAddr: elmt.orderAddr}, {code: elmt.code}]})).txhash;
                    orders.push(elmt);
                }
                data.orders = orders;
            }
            let resp = new Object(); // 결과값을 담을 오브젝트
            resp.accountType = 'company';
            resp.data = data;
            return JSON.stringify(resp);
        } else { // Addr이 일반 EOA인 경우
            let curpage = (page === undefined)? (1) : (page);
            let curtype = (type === undefined)? ('logistics') : (type);
            if (curtype != 'logistics' && curtype != 'tokens' && curtype != 'orders') { // 체크: type
                throw new Error(`Invalid Type! type: [${curtype}]`);
            }
            if (curpage > process.env.MAXPAGES || curpage == 0) { // 체크: page index
                throw new Error(`Out Of Scope Page! page: [${curpage}]`);
            }
            let data = new Object();
            data.balance = await libToken.balanceOf(token, addr); // 토큰 보유량
            data.totalLogisticsTxCount = await TxLogistics.countDocuments({$or: [{from: addr}, {recipient: addr}]}); // addr과 관련있는 TX 총갯수
            data.totalDKATransferTxCount = await TxToken.countDocuments({$or: [{from: addr}, {origin: addr}, {dest: addr}]}); // addr과 관련있는 TX 총갯수
            data.totalOrderCount = await OrderTrack.countDocuments({companyAddr: addr}); // 화주주소로 검색한 주문-구간 총 갯수 -> 화주가 주문한 주문갯수
            data.datatype = curtype; // 요청타입: 계정의 물류트랜젝션?, 토큰트랜젝션?
            if(curtype == 'logistics') {
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.totalLogisticsTxCount < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.totalLogisticsTxCount}]`);
                }
                let pageUnit = start + parseInt(process.env.MAXELMT_PERPAGE);
                let end = (data.totalLogisticsTxCount >= pageUnit)? (pageUnit) : (data.totalLogisticsTxCount);
                let lists = await TxLogistics.find({$or: [{from: addr}, {recipient: addr}]}).sort('-blockNumber').lean(true).limit(end);
                let logistics = new Array(); // TX 요약정보를 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.txHash = lists[idx].hash; // 트랜젝션 해시
                    elmt.txStatus = lists[idx].status; // 트랜젝션 상태 (success / fail / pending)
                    elmt.blockNumber = lists[idx].blockNumber; // 블록넘버
                    elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                    elmt.type = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                    logistics.push(elmt);
                }
                data.logistics = logistics;
            } else if(curtype == 'tokens') {
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.totalDKATransferTxCount < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.totalDKATransferTxCount}]`);
                }
                let pageUnit = start + parseInt(process.env.MAXELMT_PERPAGE);
                let end = (data.totalDKATransferTxCount >= start + pageUnit)? (pageUnit) : (data.totalDKATransferTxCount);
                let lists = await TxToken.find({$or: [{from: addr}, {origin: addr}, {dest: addr}]}).sort('-blockNumber').lean(true).limit(end);
                let tokens = new Array(); // TX 요약정보를 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.txHash = lists[idx].hash; // 트랜젝션 해시
                    elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                    elmt.type = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                    elmt.from = (lists[idx].txtype == 'DEPLOY')? (lists[idx].from) : (lists[idx].origin); // 주문 컨트랙트 주소
                    elmt.to = lists[idx].dest; // 물류사 컨트랙트 주소
                    elmt.amounts = lists[idx].amount; // 물류사 컨트랙트 주소
                    tokens.push(elmt);
                }
                data.tokens = tokens;
            } else { // type == 'orders'
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.totalOrderCount < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.totalOrderCount}]`);
                }
                let pageUnit = start + parseInt(process.env.MAXELMT_PERPAGE);
                let end = (data.totalOrderCount >= start + pageUnit)? (pageUnit) : (data.totalOrderCount);
                let lists = await OrderTrack.find({companyAddr: addr}).sort({blockNumber: -1, orderId: -1}).lean(true).limit(end);
                let orders = new Array(); // 주문 정보를 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.address = lists[idx].orderAddr; // 주문 컨트랙트 주소
                    elmt.id = lists[idx].orderId; // 주문 번호
                    elmt.incentiveAmounts = await libOrder.totalIncentive(lists[idx].orderAddr); // 총 인센티브
                    elmt.completion = await getOrderStatus(lists[idx].orderAddr, lists[idx].transportId); // 배송 상태
                    orders.push(elmt);
                }
                data.orders = orders;
            }
            let resp = new Object(); // 결과값을 담을 오브젝트
            resp.accountType = 'eoa';
            resp.data = data;
            return JSON.stringify(resp);
        }
    } catch(error) {
        let action = `Action: getAccountInfo`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return 'none';
    }
}

/**
 * @notice 주문 정보를 획득한다.
 * @dev getAccountInfo에 주문 컨트랙트 주소를 넣었을 때 도시되는 정보랑 동일함
 * @param {String} orderid 주문번호
 * @return 주문 정보 (json), 정보가 없거나 오류발생 시 'none'
 * @author jhhong
 */
let getOrderInfo = async function(orderid, service) {
    try {
        let addr = await libService.orders(service, orderid);
        if (addr == ZEROADDR) {
            throw new Error(`Order Not Found! ORDER-ID=[${orderid}]`);
        }
        addr = addr.toLowerCase();
        let resp = new Object(); // 결과값을 담을 오브젝트
        resp.orderAddress = addr; // 주문 컨트랙트 주소
        resp.orderId = await libOrder.orderid(addr); // 주문번호
        resp.shipperAddress =(await libOrder.tracking(addr, 0))[1]; // 화주 주소
        resp.totalIncentiveAmounts = await libOrder.totalIncentive(addr); // 총 인센티브 합
        resp.currentStep = parseInt(await libOrder.currentStep(addr)); // 주문 현재 배송구간 인덱스 (0부터 시작)
        resp.trackingCount = await libOrder.trackingCount(addr); // 주문 총 배송구간 갯수
        let tracks = new Array(); // 주문의 각 배송정보를 담을 배열
        for(let idx = 0; idx < resp.trackingCount; idx++) {
            let trackinfo = await libOrder.tracking(addr, idx); // 구간별 배송정보
            let elmt = new Object();
            elmt.companyAddress = trackinfo[1]; // 담당자 주소 (화주 or 물류사)
            elmt.status = trackinfo[2]; // 배송 코드
            elmt.type = await getAddressType(elmt.companyAddress); // 주소 타입: ('eoa' / 'company')
            if(elmt.type == 'company') {
                elmt.companyName = await libCompany.name(elmt.companyAddress); // 물류사 이름
            }
            elmt.incentiveAmounts = trackinfo[3]; // 배송 인센티브
            elmt.completion = await getOrderStatus(resp.orderAddress, idx); // 배송 상태
            elmt.txHash = (await OrderTrack.findOne({$and: [{orderAddr: addr}, {code: elmt.status}]})).txhash;
            tracks.push(elmt);
        }
        resp.tracking = tracks;
        resp.transactionCount = await TxLogistics.countDocuments({orderAddr: addr}); // 주문과 관련된 Tx 총 갯수
        let txs = await TxLogistics.find({orderAddr: addr}).sort('-blockNumber').lean(true).limit(resp.logisticsCount);
        let logistics = new Array(); // 주문과 관련된 각 Tx 정보들을 담을 배열
        for(let idx = 0; idx < resp.transactionCount; idx++) {
            let elmt = new Object();
            elmt.txHash = txs[idx].hash; // 트랜젝션 해시
            elmt.txStatus = txs[idx].status; // 트랜젝션 상태 (success / fail / pending)
            elmt.blockNumber = txs[idx].blockNumber; // 블록넘버
            elmt.time = txs[idx].timestamp; // timestamp (epoch time)
            elmt.type = await getTxType(txs[idx].txtype); // 트랜젝션 타입
            logistics.push(elmt);
        }
        resp.logistics = logistics;
        return JSON.stringify(resp);
    } catch(error) {
        let action = `Action: getOrderInfo`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return 'none';
    }
}

/**
 * @notice 트랜젝션 상세정보를 획득한다.
 * @param {String} txhash 트랜젝션 해시값
 * @return 트랜젝션 상세정보 (json), 정보가 없거나 오류발생 시 'none'
 * @author jhhong
 */
let getTransactionInfo = async function(txhash) {
    try {
        if(txhash.length !== 66) { // 체크: addr format
            throw new Error(`Invalid Transaction Format! txhash: [${txhash}]`);
        }
        let resp = new Object(); // 결과값을 담을 오브젝트
        if(await TxLogistics.countDocuments({hash: txhash}) > 0) {
            let data = await TxLogistics.findOne({hash: txhash});
            let blockchain = new Object(); // blockchain 정보를 담을 오브젝트
            blockchain.txStatus = data.status; // 트랜젝션 상태
            blockchain.blockNumber = data.blockNumber; // 블록넘버
            blockchain.timestamp = data.timestamp; // 트랜젝션 생성 시각 (epoch time)
            blockchain.from = data.from; // 송신자 주소
            blockchain.to = data.to; // 수신자 주소
            blockchain.value = data.value; // 트랜젝션에 드는 이더 양
            blockchain.txFee = data.txfee; // 수수료
            blockchain.gasLimit = data.gas; // GAS Limit
            blockchain.gasUsed = data.gasUsed; // 실제 사용한 GAS양
            blockchain.gasPrice = data.gasPrice; // GAS 가격
            blockchain.nonce = data.nonce; // nonce값
            resp.blockchain = blockchain; // 블록체인 정보 저장 - 끝 -
            let logistics  = new Object(); // logistics 정보를 담을 오브젝트
            switch(data.txtype) { // 발생빈도 순 정렬
            case 'ORDER-LAUNCH': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddress = data.orderAddr; // 주문 컨트랙트 주소
                txdata.transportId = data.transportId; // 운송번호
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                logistics.txData = txdata;
                logistics.txType = data.txtype; // 물류 타입
                break;
            }
            case 'ORDER-UPDATE': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddress = data.orderAddr; // 주문 컨트랙트 주소
                txdata.transportId = data.transportId; // 운송번호
                txdata.status = data.code; // 배송코드
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                logistics.txData = txdata;
                logistics.txType = data.txtype; // 물류 타입
                break;
            }
            case 'SUBMIT': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddress = data.orderAddr; // 주문 컨트랙트 주소
                logistics.txData = txdata;
                logistics.txType = data.txtype; // 물류 타입
                break;
            }
            case 'DEPLOY': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                switch(data.deployedType) {
                case 'order': // 주문 컨트랙트
                    txdata.contractAddress = data.orderAddr;
                    break;
                case 'company': // 물류사 컨트랙트
                    txdata.contractAddress = data.companyAddr;
                    break;
                default: // 서비스 컨트랙트
                    txdata.contractAddress = data.serviceAddr;
                    break;
                }
                txdata.contractType = data.deployedType; // 컨트랙트 타입 (service / company / order)
                logistics.txData = txdata;
                logistics.txType = data.txtype; // 물류 타입
                break;
            }
            case 'REGISTER':
            case 'UNREGISTER': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                logistics.txData = txdata;
                logistics.txType = data.txtype; // 물류 타입
                break;
            }
            case 'SETTLEMENT': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.recipient = data.recipient; // 물류사 이름
                txdata.payments = data.param01; // 인센티브 정산 지급액
                txdata.rests = data.param02; // 인센티브 잔액
                logistics.txData = txdata;
                logistics.txType = 'SETTLEMENT'; // 물류 타입
                break;
            }
            case 'addOperator': {
                let txdata = new Object();
                txdata.manageType = "ADD OPERATOR";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.operator = data.param01; // 운영자 주소
                logistics.txData = txdata;
                logistics.txType = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'removeOperator': {
                let txdata = new Object();
                txdata.manageType = "REMOVE OPERATOR";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.operator = data.param01; // 운영자 주소
                logistics.txData = txdata;
                logistics.txType = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setName': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY NAME";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.oldName = data.param01; // 물류사의 기존 이름
                txdata.newName = data.param02; // 물류사의 새로운 이름
                logistics.txData = txdata;
                logistics.txType = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setUrl': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY URL";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.oldUrl = data.param01; // 물류사의 기존 URL
                txdata.newUrl = data.param02; // 물류사의 새로운 URL
                logistics.txData = txdata;
                logistics.txType = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setRecipient': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY RECIPIENT";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddress = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.oldRecipient = data.param01; // 물류사의 기존 수취인주소
                txdata.newRecipient = data.param02; // 물류사의 새로운 수취인주소
                logistics.txData = txdata;
                logistics.txType = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setOrderUrl': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY URL";
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddress = data.orderAddr; // 주문 컨트랙트 주소
                txdata.oldUrl = data.param01; // 주문 상세내역의 기존 URL
                txdata.newUrl = data.param02; // 주문 상세내역의 새로운 URL
                logistics.txData = txdata;
                logistics.txType = 'MANAGEMENT'; // 물류 타입
                break;
            }
            default:
                throw new Error(`Unsupported TX TYPE! txtype: [${data.txtype}]`);
            }
            resp.logistics = logistics; // 물류 정보 저장 - 끝 -
            if(await EvtLogistics.countDocuments({txHash: txhash}) > 0) {
                let events = new Object();
                let list = await EvtLogistics.find({txHash: txhash});
                events.count = list.length;
                let eventLogs = new Array();
                for(let i = 0; i < list.length; i++) {
                    let eventLog = new Object();
                    eventLog.name = list[i].eventName;
                    eventLog.paramCnt = list[i].paramCount;
                    let params = new Array();
                    if(list[i].paramName01 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName01;
                        param.type = list[i].paramType01;
                        param.data = list[i].paramData01;
                        params.push(param);
                    }
                    if(list[i].paramName02 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName02;
                        param.type = list[i].paramType02;
                        param.data = list[i].paramData02;
                        params.push(param);
                    }
                    if(list[i].paramName03 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName03;
                        param.type = list[i].paramType03;
                        param.data = list[i].paramData03;
                        params.push(param);
                    }
                    if(list[i].paramName04 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName04;
                        param.type = list[i].paramType04;
                        param.data = list[i].paramData04;
                        params.push(param);
                    }
                    eventLog.params = params;
                    eventLogs.push(eventLog);
                }
                events.eventLogs = eventLogs;
                resp.events = events; // 이벤트 로그 저장 - 끝 -
            }
        } else if(await TxToken.countDocuments({hash: txhash}) > 0) {
            let data = await TxToken.findOne({hash: txhash});
            let blockchain = new Object(); // blockchain 정보를 담을 오브젝트
            blockchain.status = data.status; // 트랜젝션 상태
            blockchain.blockNumber = data.blockNumber; // 블록넘버
            blockchain.timestamp = data.timestamp; // 트랜젝션 생성 시각 (epoch time)
            blockchain.from = data.from; // 송신자 주소
            blockchain.to = data.to; // 수신자 주소
            blockchain.value = data.value; // 트랜젝션에 드는 이더 양
            blockchain.txfee = data.txfee; // 수수료
            blockchain.gasLimit = data.gas; // GAS Limit
            blockchain.gasUsed = data.gasUsed; // 실제 사용한 GAS양
            blockchain.gasPrice = data.gasPrice; // GAS 가격
            blockchain.nonce = data.nonce; // nonce값
            resp.blockchain = blockchain; // 블록체인 정보 저장 - 끝 -
            let tokens  = new Object(); // token TX 정보를 담을 오브젝트
            tokens.txType = data.txtype; // token TX 타입
            switch(data.txtype) {
            case 'DEPLOY': {
                if(data.deployedType != 'token') {
                    throw new Error(`Unsupported CONTRACT TYPE! txtype: [${data.deployedType}]`);
                }
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.contractType = data.deployedType; // 컨트랙트 타입 (token only)
                txdata.contractAddr = data.tokenAddr;
                tokens.txData = txdata;
                break;
            }
            case 'TRANSFER': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.origin = data.origin; // 토큰 송신자 주소
                txdata.destination = data.dest; // 토큰 수신자 주소
                txdata.amounts = data.amount; // 토큰 양
                tokens.txData = txdata;
                break;
            }
            case 'BURN': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.origin = data.origin; // 토큰 소각자 주소
                txdata.amounts = data.amount; // 토큰 소각양
                tokens.txData = txdata;
                break;
            }
            case 'APPROVE': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.origin = data.origin; // 토큰 보유자 주소
                txdata.destination = data.dest; // 토큰 위임자 주소
                txdata.amounts = data.amount; // 토큰 위임양
                tokens.txData = txdata;
                break;
            }
            default:
                throw new Error(`Unsupported TX TYPE! txtype: [${data.txtype}]`);
            }
            resp.tokens = tokens; // 토큰 정보 저장 - 끝 -
            if(await EvtToken.countDocuments({txHash: txhash}) > 0) {
                let events = new Object();
                let list = await EvtToken.find({txHash: txhash});
                events.count = list.length;
                let eventLogs = new Array();
                for(let i = 0; i < list.length; i++) {
                    let eventLog = new Object();
                    eventLog.name = list[i].eventName;
                    eventLog.paramCnt = list[i].paramCount;
                    let params = new Array();
                    if(list[i].paramName01 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName01;
                        param.type = list[i].paramType01;
                        param.data = list[i].paramData01;
                        params.push(param);
                    }
                    if(list[i].paramName02 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName02;
                        param.type = list[i].paramType02;
                        param.data = list[i].paramData02;
                        params.push(param);
                    }
                    if(list[i].paramName03 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName03;
                        param.type = list[i].paramType03;
                        param.data = list[i].paramData03;
                        params.push(param);
                    }
                    if(list[i].paramName04 != undefined) {
                        let param = new Object();
                        param.name = list[i].paramName04;
                        param.type = list[i].paramType04;
                        param.data = list[i].paramData04;
                        params.push(param);
                    }
                    eventLog.params = params;
                    eventLogs.push(eventLog);
                }
                events.eventLogs = eventLogs;
                resp.events = events; // 이벤트 로그 저장 - 끝 -
            }
        } else {
            throw new Error(`Not Found! txhash: [${txhash}]`);
        }
        return JSON.stringify(resp);
    } catch(error) {
        let action = `Action: getTransactionInfo`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return 'none';
    }
}

/**
 * @notice Overview 정보를 획득한다.
 * @dev Overview 정보:
 * @dev - 주문 수량(총합)
 * @dev - 주문 수량(일일)
 * @dev - 물류Tx 개수(총합)
 * @dev - 물류Tx 개수(일일)
 * @dev - 주문 리스트 (order address, order id, status)
 * @dev - Tx 리스트 (tx hash, block, tx type)
 * @return Overview 정보
 * @author jhhong
 */
let getOverviews = async function() {
    try {
        let limittm = parseInt(new Date().getTime() / 1000) - 86400; // 하루 전 시각 (epoch time)
        let resp = new Object(); // 결과값을 담을 오브젝트
        resp.dailyOrderCount = await TxLogistics.countDocuments({$and:[{txtype: "SUBMIT"}, {status: "Success"}, {timestamp: {$gt: limittm}}]});
        resp.totalOrderCount = await TxLogistics.countDocuments({$and:[{txtype: "SUBMIT"}, {status: "Success"}]});
        resp.dailyTxCount    = await TxLogistics.countDocuments({timestamp: {$gt: limittm}});
        resp.totalTxCount    = await TxLogistics.countDocuments();
        let orderlists = await OrderTrack.find({code: '10'}).sort({blockNumber: -1, orderId: -1}).lean(true).limit(10);
        let orders = new Array(); // 물류사 담당 주문-구간을 담을 배열
        for(let idx = 0; idx < orderlists.length; idx++) {
            let elmt = new Object();
            elmt.address = orderlists[idx].orderAddr; // 주문 컨트랙트 주소
            elmt.id = orderlists[idx].orderId; // 주문 번호
            elmt.completion = await getOrderStatus(orderlists[idx].orderAddr, orderlists[idx].transportId); // 배송 상태
            orders.push(elmt);
        }
        resp.orders = orders;
        let txlists = await TxLogistics.find().sort('-blockNumber').lean(true).limit(10);
        let txs = new Array(); // TX 요약정보를 담을 배열
        for(let idx = 0; idx < txlists.length; idx++) {
            let elmt = new Object();
            elmt.txHash = txlists[idx].hash; // 트랜젝션 해시
            elmt.blockNumber = txlists[idx].blockNumber; // 블록넘버
            elmt.type = await getTxType(txlists[idx].txtype); // 트랜젝션 타입
            txs.push(elmt);
        }
        resp.txs = txs;
        return JSON.stringify(resp);
    } catch(error) {
        let action = `Action: getOverviews`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return 'none';
    }
}

/**
 * @notice 주문 리스트 정보를 획득한다.
 * @param {Number} page 페이지 인덱스 (page * 25 == 시작 인덱스)
 * @param {String} service 서비스 컨트랙트 주소
 * @return 계정 정보 (json), 정보가 없거나 오류발생 시 'none'
 * @author jhhong
 */
let getOrderlist = async function(page, service) {
    try {
        let curpage = (page === undefined)? (1) : (page);
        let maxpage = parseInt(process.env.MAXPAGES);
        let maxelmt = parseInt(process.env.MAXELMT_PERPAGE);
        if (curpage > maxpage || curpage == 0) { // 체크: page index
            throw new Error(`Out Of Scope Page! page: [${curpage}]`);
        }
        let ordercnt = parseInt(await libService.orderCount(service));
        let start = (curpage-1) * maxelmt;
        if (ordercnt < start) {
            throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${ordercnt}]`);
        }

        let pageUnit = start + maxelmt;
        let end = (ordercnt >= pageUnit)? (pageUnit) : (ordercnt);
        let lists = await OrderTrack.find({code: '10'}).sort({blockNumber: -1, orderId: -1}).lean(true).limit(end);
        let orders = new Array(); // 물류사 담당 주문-구간을 담을 배열
        for(let idx = start; idx < end; idx++) {
            let elmt = new Object();
            elmt.address = lists[idx].orderAddr; // 주문 컨트랙트 주소
            elmt.id = lists[idx].orderId; // 주문 번호
            elmt.incentiveAmounts = lists[idx].incentives; // 인센티브
            elmt.completion = await getOrderStatus(lists[idx].orderAddr, lists[idx].transportId); // 배송 상태
            orders.push(elmt);
        }
        let resp = new Object(); // 결과값을 담을 오브젝트
        resp.count = ordercnt;
        resp.orders = orders;
        return JSON.stringify(resp);
    } catch(error) {
        let action = `Action: getOrderlist`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return 'none';
    }
}

/**
 * @notice 트랜젝션 리스트 정보를 획득한다.
 * @param {Number} page 페이지 인덱스 (page * 25 == 시작 인덱스)
 * @param {String} type 도시할 정보 타입 (logistics / token)
 * @return 계정 정보 (json), 정보가 없거나 오류발생 시 'none'
 * @author jhhong
 */
let getTxlist = async function(page, type) {
    try {
        let curpage = (page === undefined)? (1) : (page);
        let curtype = (type === undefined)? ('logistics') : (type);
        if (curtype != 'logistics' && curtype != 'tokens') { // 체크: type
            throw new Error(`Invalid Type! type: [${curtype}]`);
        }
        if (curpage > process.env.MAXPAGES || curpage == 0) { // 체크: page index
            throw new Error(`Out Of Scope Page! page: [${curpage}]`);
        }
        let resp = new Object(); // 결과값을 담을 오브젝트
        resp.totalLogisticsTxCount = await TxLogistics.countDocuments(); // Logistics TX 총갯수
        resp.totalDKATransferTxCount = await TxToken.countDocuments(); // Tokens TX 총갯수
        resp.datatype = curtype; // 요청타입: 계정의 물류트랜젝션?, 토큰트랜젝션?
        if(curtype == 'logistics') {
            let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
            if(resp.totalLogisticsTxCount < start) {
                throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${resp.totalLogisticsTxCount}]`);
            }
            let pageUnit = start + parseInt(process.env.MAXELMT_PERPAGE);
            let end = (resp.totalLogisticsTxCount >= pageUnit)? (pageUnit) : (resp.totalLogisticsTxCount);
            let lists = await TxLogistics.find().sort('-blockNumber').lean(true).limit(end);
            let logistics = new Array(); // TX 요약정보를 담을 배열
            for(let idx = start; idx < end; idx++) {
                let elmt = new Object();
                elmt.txHash = lists[idx].hash; // 트랜젝션 해시
                elmt.txStatus = lists[idx].status; // 트랜젝션 상태 (success / fail / pending)
                elmt.blockNumber = lists[idx].blockNumber; // 블록넘버
                elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                elmt.type = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                logistics.push(elmt);
            }
            resp.logistics = logistics;
        } else {
            let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
            if(resp.totalDKATransferTxCount < start) {
                throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${resp.totalDKATransferTxCount}]`);
            }
            let pageUnit = start + parseInt(process.env.MAXELMT_PERPAGE);
            let end = (resp.totalDKATransferTxCount >= start + pageUnit)? (pageUnit) : (resp.totalDKATransferTxCount);
            let lists = await TxToken.find().sort('-blockNumber').lean(true).limit(end);
            let tokens = new Array(); // TX 요약정보를 담을 배열
            for(let idx = start; idx < end; idx++) {
                let elmt = new Object();
                elmt.txHash = lists[idx].hash; // 트랜젝션 해시
                elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                elmt.type = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                elmt.from = (lists[idx].txtype == 'DEPLOY')? (lists[idx].from) : (lists[idx].origin); // 주문 컨트랙트 주소
                elmt.to = lists[idx].dest; // 물류사 컨트랙트 주소
                elmt.amounts = lists[idx].amount; // 물류사 컨트랙트 주소
                tokens.push(elmt);
            }
            resp.tokens = tokens;
        }
        return JSON.stringify(resp);

    } catch(error) {
        let action = `Action: getTxlist`;
        Log('ERROR', `exception occured!:\n${action}\n${RED(error.stack)}`);
        return 'none';
    }
}

/**
 * @notice EXPLORER REQUEST 처리 routing 수행 함수
 * @param {Object} app     Express Object
 * @param {String} service Express Object
 * @param {String} token   Express Object
 * @author jhhong
 */
module.exports = function(app, service, token) {
    app.get('/account/:address', async function(req, res) {
        let ret = await getAccountInfo(req.params.address, req.query.p, req.query.type, service, token);
        res.end(ret);
    });
    app.get('/order/:orderid', async function(req, res) {
        let ret = await getOrderInfo(req.params.orderid, service);
        res.end(ret);
    });
    app.get('/transaction/:txhash', async function(req, res) {
        let ret = await getTransactionInfo(req.params.txhash);
        res.end(ret);
    });
    app.get('/overviews', async function(req, res) {
        let ret = await getOverviews();
        res.end(ret);
    });
    app.get('/orderlist', async function(req, res) {
        let ret = await getOrderlist(req.query.p, service);
        res.end(ret);
    });
    app.get('/txlist', async function(req, res) {
        let ret = await getTxlist(req.query.p, req.query.type);
        res.end(ret);
    });
}