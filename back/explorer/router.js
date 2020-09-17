/**
 * @file router.js
 * @notice EXPLORER REQUEST 처리 라우팅 기능 담당
 * @author jhhong
 */

//// COMMON
const colors = require('colors/safe'); // 콘솔 Color 출력
const path   = require('path'); // .env 경로 추출을 위함

//// LOGs
const Log = require('../libs/libLog.js').Log; // 로그 출력

//// ABIs
const abiPrefix = require('../build/contracts/DkargoPrefix.json').abi; // 컨트랙트 ABI
const abiERC165 = require('../build/contracts/ERC165.json').abi; // 컨트랙트 ABI

//// DOTENV
require('dotenv').config({ path: path.join(__dirname, '../.env') }); // 지정된 경로의 환경변수 사용 (.env 파일 참조)

//// DBs
require('./db.js'); // for mongoose schema import
const mongoose     = require('mongoose');
const TxLogistics  = mongoose.model('ExpTxLogistics'); // module.exports
const TxToken      = mongoose.model('ExpTxToken'); // module.exports
const OrderTrack   = mongoose.model('ExpOrderTrack'); // module.exports
const EvtLogistics = mongoose.model('ExpEvtLogistics'); // module.exports
const EvtToken     = mongoose.model('ExpEvtToken'); // module.exports

//// APIs & LIBs
const libService = require('../libs/libDkargoService.js'); // 서비스 컨트랙트 관련 Library
const libCompany = require('../libs/libDkargoCompany.js'); // 물류사 컨트랙트 관련 Library
const libOrder   = require('../libs/libDkargoOrder.js'); // 주문 컨트랙트 관련 Library
const libToken   = require('../libs/libDkargoToken.js'); // 토큰 컨트랙트 관련 Library
const ZEROADDR   = require('../libs/libCommon.js').ZEROADDR; // ZERO-ADDRESS 상수

//// WEB3
const web3 = require('../libs/Web3.js').prov2; // 물류 관련 provider

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
            if(await isDkargoContract(addr) == true) {
                switch(await getDkargoPrefix(addr)) {
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
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
        return null;
    }
}

/**
 * @notice 주문 상태를 반환한다.
 * @param {String} addr 주문 컨트랙트 주소
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
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
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
        case 'MARK-PAYMENT':     // 주문이 결제되었음을 확인
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
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
        return null;
    }
}

/**
 * @notice 계정 정보를 획득한다.
 * @dev 표현 가능 Account 정보: EOA / CA(Company) / CA(Order), 차후 CA(Service)도 추가 예정
 * @param {String} addr 계정 주소
 * @param {Number} page 페이지 인덱스 (page * 25 == 시작 인덱스)
 * @param {String} type 도시할 정보 타입 (logistics / token)
 * @param {String} service 서비스 컨트랙트 주소
 * @param {String} token 토큰 컨트랙트 주소
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
            data.orderAddr = addr; // 주문 컨트랙트 주소
            data.orderId = await libOrder.orderid(addr); // 주문번호
            data.shipper =(await libOrder.tracking(addr, 0))[1]; // 화주 주소
            data.totalIncentives = await libOrder.totalIncentive(addr); // 총 인센티브 합
            data.url = await libOrder.url(addr); // 주문 상세 URL
            data.currentStep = parseInt(await libOrder.currentStep(addr)) + 1; // 주문 현재 배송구간 인덱스 (0부터 시작 -> +1)
            data.trackingCount = await libOrder.trackingCount(addr); // 주문 총 배송구간 갯수
            if(await libOrder.isComplete(addr) == true) {
                data.trackingCount -= 1; // 배송완료된 주문일 경우 "TRACKCODE_COMPLETE"에 해당하는 트래킹정보를 제외하기 위함
            }
            let tracks = new Array(); // 주문의 각 배송정보를 담을 배열
            for(let idx = 0; idx < data.trackingCount; idx++) {
                let trackinfo = await libOrder.tracking(addr, idx); // 구간별 배송정보
                let elmt = new Object();
                elmt.addr = trackinfo[1]; // 담당자 주소 (화주 or 물류사)
                elmt.code = trackinfo[2]; // 배송 코드
                elmt.type = await getAddressType(elmt.addr); // 주소 타입: ('eoa' / 'company')
                if(elmt.type == 'company') {
                    elmt.name = await libCompany.name(elmt.addr); // 물류사 이름
                }
                elmt.incentives = trackinfo[3]; // 배송 인센티브
                elmt.status = await getOrderStatus(data.orderAddr, idx); // 배송 상태
                tracks.push(elmt);
            }
            data.tracking = tracks;
            data.logisticsCount = await TxLogistics.countDocuments({orderAddr: addr}); // 주문과 관련된 Tx 총 갯수
            let txs = await TxLogistics.find({orderAddr: addr}); // 주문과 관련된 Tx Details (txs.length == data.logisticsCount)
            let logistics = new Array(); // 주문과 관련된 각 Tx 정보들을 담을 배열
            for(let idx = 0; idx < data.logisticsCount; idx++) {
                let elmt = new Object();
                elmt.txhash = txs[idx].hash; // 트랜젝션 해시
                elmt.status = txs[idx].status; // 트랜젝션 상태 (success / fail / pending)
                elmt.blockNumber = txs[idx].blockNumber; // 블록넘버
                elmt.time = txs[idx].timestamp; // timestamp (epoch time)
                elmt.txtype = await getTxType(txs[idx].txtype); // 트랜젝션 타입
                logistics.push(elmt);
            }
            data.logistics = logistics;
            resp.data = data;
            return JSON.stringify(resp);
        } else if(addrtype == 'company') { // Addr이 물류사 컨트랙트 주소인 경우
            let curpage = (page === undefined)? (1) : (page);
            let curtype = (type === undefined)? ('txns') : (type);
            if(curtype != 'txns' && curtype != 'orders') { // 체크: type
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
            data.companyAddr = addr; // 물류사 컨트랙트 주소
            data.companyName = await libCompany.name(addr); // 물류사 이름
            data.url = await libCompany.url(addr); // 물류사 상세정보 URL (ie. Home Page)
            data.recipient = await libCompany.recipient(addr); // 물류사 수취인 주소
            data.grade = await libService.degree(service, addr); // 물류사의 평점 획득
            data.txnsCnt = await TxLogistics.countDocuments({companyAddr: addr}); // addr과 관련있는 TX 총갯수
            data.ordersCnt = await OrderTrack.countDocuments({companyAddr: addr}); // 물류사가 담당하는 주문-구간 총 갯수
            data.datatype = type; // 요청타입: txns / orders
            if(curtype == 'txns') {
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.txnsCnt < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.txnsCnt}]`);
                }
                let end = (data.txnsCnt >= start + process.env.MAXELMT_PERPAGE)? (start + process.env.MAXELMT_PERPAGE) : (data.txnsCnt);
                let lists = await TxLogistics.find({companyAddr: addr});
                let txns = new Array(); // TX 요약정보를 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.txhash = lists[idx].hash; // 트랜젝션 해시
                    elmt.status = lists[idx].status; // 트랜젝션 상태 (success / fail / pending)
                    elmt.blockNumber = lists[idx].blockNumber; // 블록넘버
                    elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                    elmt.txtype = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                    txns.push(elmt);
                }
                data.txns = txns;
            } else { // type == 'orders'
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.ordersCnt < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.ordersCnt}]`);
                }
                let end = (data.ordersCnt >= start + process.env.MAXELMT_PERPAGE)? (start + process.env.MAXELMT_PERPAGE) : (data.ordersCnt);
                let lists = await OrderTrack.find({companyAddr: addr}); // 물류사 담당 주문-구간 Lists
                let orders = new Array(); // 물류사 담당 주문-구간을 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.orderAddr = lists[idx].orderAddr; // 주문 컨트랙트 주소
                    elmt.orderId = lists[idx].orderId; // 주문 번호
                    elmt.incentives = lists[idx].incentives; // 인센티브
                    elmt.code = lists[idx].code; // 배송 코드
                    elmt.status = await getOrderStatus(lists[idx].orderAddr, lists[idx].transportId); // 배송 상태
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
            if(curtype != 'logistics' && curtype != 'tokens') { // 체크: type
                throw new Error(`Invalid Type! type: [${curtype}]`);
            }
            if(curpage > process.env.MAXPAGES || curpage == 0) { // 체크: page index
                throw new Error(`Out Of Scope Page! page: [${curpage}]`);
            }
            let data = new Object();
            data.balance = await libToken.balanceOf(token, addr); // 토큰 보유량
            data.logisticsCnt = await TxLogistics.countDocuments({from: addr}); // addr과 관련있는 TX 총갯수
            data.tokensCnt = await TxToken.countDocuments({$or: [{from: addr}, {origin: addr}, {dest: addr}]}); // addr과 관련있는 TX 총갯수
            data.datatype = curtype; // 요청타입: 계정의 물류트랜젝션?, 토큰트랜젝션?
            if(curtype == 'logistics') {
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.logisticsCnt < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.logisticsCnt}]`);
                }
                let end = (data.logisticsCnt >= start + process.env.MAXELMT_PERPAGE)? (start + process.env.MAXELMT_PERPAGE) : (data.logisticsCnt);
                let lists = await TxLogistics.find({from: addr});
                let logistics = new Array(); // TX 요약정보를 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.txhash = lists[idx].hash; // 트랜젝션 해시
                    elmt.status = lists[idx].status; // 트랜젝션 상태 (success / fail / pending)
                    elmt.blockNumber = lists[idx].blockNumber; // 블록넘버
                    elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                    elmt.txtype = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                    logistics.push(elmt);
                }
                data.logistics = logistics;
            } else { // type == 'tokens'
                let start = (curpage-1) * process.env.MAXELMT_PERPAGE;
                if(data.tokensCnt < start) {
                    throw new Error(`Invalid Page Index! Start Index=[${start}], Total count=[${data.tokensCnt}]`);
                }
                let end = (data.tokensCnt >= start + process.env.MAXELMT_PERPAGE)? (start + process.env.MAXELMT_PERPAGE) : (data.tokensCnt);
                let lists = await TxToken.find({$or: [{from: addr}, {origin: addr}, {dest: addr}]});
                let tokens = new Array(); // TX 요약정보를 담을 배열
                for(let idx = start; idx < end; idx++) {
                    let elmt = new Object();
                    elmt.txhash = lists[idx].hash; // 트랜젝션 해시
                    elmt.time = lists[idx].timestamp; // 트랜젝션 생성시각
                    elmt.txtype = await getTxType(lists[idx].txtype); // 트랜젝션 타입
                    elmt.from = (lists[idx].txtype == 'DEPLOY')? (lists[idx].from) : (lists[idx].origin); // 주문 컨트랙트 주소
                    elmt.to = lists[idx].dest; // 물류사 컨트랙트 주소
                    elmt.amount = lists[idx].amount; // 물류사 컨트랙트 주소
                    tokens.push(elmt);
                }
                data.tokens = tokens;
            }
            let resp = new Object(); // 결과값을 담을 오브젝트
            resp.accountType = 'eoa';
            resp.data = data;
            return JSON.stringify(resp);
        }
    } catch(error) {
        let action = `Action: getAccountInfo`;
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
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
        resp.orderAddr = addr; // 주문 컨트랙트 주소
        resp.orderId = await libOrder.orderid(addr); // 주문번호
        resp.shipper =(await libOrder.tracking(addr, 0))[1]; // 화주 주소
        resp.totalIncentives = await libOrder.totalIncentive(addr); // 총 인센티브 합
        resp.url = await libOrder.url(addr); // 주문 상세 URL
        resp.currentStep = parseInt(await libOrder.currentStep(addr)) + 1; // 주문 현재 배송구간 인덱스 (0부터 시작 -> +1)
        resp.trackingCount = await libOrder.trackingCount(addr); // 주문 총 배송구간 갯수
        if(await libOrder.isComplete(addr) == true) {
            resp.trackingCount -= 1; // 배송완료된 주문일 경우 "TRACKCODE_COMPLETE"에 해당하는 트래킹정보를 제외하기 위함
        }
        let tracks = new Array(); // 주문의 각 배송정보를 담을 배열
        for(let idx = 0; idx < resp.trackingCount; idx++) {
            let trackinfo = await libOrder.tracking(addr, idx); // 구간별 배송정보
            let elmt = new Object();
            elmt.addr = trackinfo[1]; // 담당자 주소 (화주 or 물류사)
            elmt.code = trackinfo[2]; // 배송 코드
            elmt.type = await getAddressType(elmt.addr); // 주소 타입: ('eoa' / 'company')
            if(elmt.type == 'company') {
                elmt.name = await libCompany.name(elmt.addr); // 물류사 이름
            }
            elmt.incentives = trackinfo[3]; // 배송 인센티브
            elmt.status = await getOrderStatus(resp.orderAddr, idx); // 배송 상태
            tracks.push(elmt);
        }
        resp.tracking = tracks;
        resp.logisticsCount = await TxLogistics.countDocuments({orderAddr: addr}); // 주문과 관련된 Tx 총 갯수
        let txs = await TxLogistics.find({orderAddr: addr}); // 주문과 관련된 Tx Details (txs.length == resp.logisticsCount)
        let logistics = new Array(); // 주문과 관련된 각 Tx 정보들을 담을 배열
        for(let idx = 0; idx < resp.logisticsCount; idx++) {
            let elmt = new Object();
            elmt.txhash = txs[idx].hash; // 트랜젝션 해시
            elmt.status = txs[idx].status; // 트랜젝션 상태 (success / fail / pending)
            elmt.blockNumber = txs[idx].blockNumber; // 블록넘버
            elmt.time = txs[idx].timestamp; // timestamp (epoch time)
            elmt.txtype = await getTxType(txs[idx].txtype); // 트랜젝션 타입
            logistics.push(elmt);
        }
        resp.logistics = logistics;
        return JSON.stringify(resp);
    } catch(error) {
        let action = `Action: getOrderInfo`;
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
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
            let logistics  = new Object(); // logistics 정보를 담을 오브젝트
            switch(data.txtype) { // 발생빈도 순 정렬
            case 'ORDER-LAUNCH': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddr = data.orderAddr; // 주문 컨트랙트 주소
                txdata.transportId = data.transportId; // 운송번호
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = data.txtype; // 물류 타입
                break;
            }
            case 'ORDER-UPDATE': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddr = data.orderAddr; // 주문 컨트랙트 주소
                txdata.transportId = data.transportId; // 운송번호
                txdata.code = data.code; // 배송코드
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = data.txtype; // 물류 타입
                break;
            }
            case 'MARK-PAYMENT': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddr = data.orderAddr; // 주문 컨트랙트 주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = data.txtype; // 물류 타입
                break;
            }
            case 'SUBMIT': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddr = data.orderAddr; // 주문 컨트랙트 주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = data.txtype; // 물류 타입
                break;
            }
            case 'DEPLOY': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                switch(data.deployedType) {
                case 'order': // 주문 컨트랙트
                    txdata.contractAddr = data.orderAddr;
                    break;
                case 'company': // 물류사 컨트랙트
                    txdata.contractAddr = data.companyAddr;
                    break;
                default: // 서비스 컨트랙트
                    txdata.contractAddr = data.serviceAddr;
                    break;
                }
                txdata.contractType = data.deployedType; // 컨트랙트 타입 (service / company / order)
                txdata.creator = data.creator; // 컨트랙트 소유자 주소 (=from)
                logistics.txdata = txdata;
                logistics.txtype = data.txtype; // 물류 타입
                break;
            }
            case 'REGISTER':
            case 'UNREGISTER': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = data.txtype; // 물류 타입
                break;
            }
            case 'addOperator': {
                let txdata = new Object();
                txdata.manageType = "ADD OPERATOR";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.operator = data.param01; // 운영자 주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'removeOperator': {
                let txdata = new Object();
                txdata.manageType = "REMOVE OPERATOR";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.operator = data.param01; // 운영자 주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setName': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY NAME";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.oldName = data.param01; // 물류사의 기존 이름
                txdata.newName = data.param02; // 물류사의 새로운 이름
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setUrl': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY URL";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.oldUrl = data.param01; // 물류사의 기존 URL
                txdata.newUrl = data.param02; // 물류사의 새로운 URL
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setRecipient': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY RECIPIENT";
                txdata.companyName = data.companyName; // 물류사 이름
                txdata.companyAddr = data.companyAddr; // 물류사 컨트랙트 주소
                txdata.oldRecipient = data.param01; // 물류사의 기존 수취인주소
                txdata.newRecipient = data.param02; // 물류사의 새로운 수취인주소
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = 'MANAGEMENT'; // 물류 타입
                break;
            }
            case 'setOrderUrl': {
                let txdata = new Object();
                txdata.manageType = "CHANGE COMPANY URL";
                txdata.orderId = data.orderId; // 주문번호
                txdata.orderAddr = data.orderAddr; // 주문 컨트랙트 주소
                txdata.oldUrl = data.param01; // 주문 상세내역의 기존 URL
                txdata.newUrl = data.param02; // 주문 상세내역의 새로운 URL
                txdata.creator = data.creator; // 컨트랙트 소유자 주소
                logistics.txdata = txdata;
                logistics.txtype = 'MANAGEMENT'; // 물류 타입
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
            tokens.txtype = data.txtype; // token TX 타입
            switch(data.txtype) {
            case 'DEPLOY': {
                if(data.deployedType != 'token') {
                    throw new Error(`Unsupported CONTRACT TYPE! txtype: [${data.deployedType}]`);
                }
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.contractType = data.deployedType; // 컨트랙트 타입 (token only)
                txdata.contractAddr = data.tokenAddr;
                txdata.creator = data.creator; // 컨트랙트 소유자 주소 (=from)
                tokens.txdata = txdata;
                break;
            }
            case 'TRANSFER': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.origin = data.origin; // 토큰 송신자 주소
                txdata.dest = data.dest; // 토큰 수신자 주소
                txdata.amount = data.amount; // 토큰 양
                tokens.txdata = txdata;
                break;
            }
            case 'BURN': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.origin = data.origin; // 토큰 소각자 주소
                txdata.amount = data.amount; // 토큰 소각양
                tokens.txdata = txdata;
                break;
            }
            case 'APPROVE': {
                let txdata = new Object(); // txtype별 data를 담을 오브젝트
                txdata.origin = data.origin; // 토큰 보유자 주소
                txdata.dest = data.dest; // 토큰 위임자 주소
                txdata.amount = data.amount; // 토큰 위임양
                tokens.txdata = txdata;
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
        Log('ERROR', `exception occured!:\n${action}\n${colors.red(error.stack)}`);
        return 'none';
    }
}

/**
 * @notice EXPLORER REQUEST 처리 routing 수행 함수
 * @param {Object} app Express Object
 * @param {String} service Express Object
 * @param {String} token Express Object
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
}