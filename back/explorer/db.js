/**
 * @file db.js
 * @notice DB (mongoose) schema 정의 및 구동 파일
 * @author jhhong
 */
const mongoose = require('mongoose');
/**
 * @notice Block Schema, 블록 정보
 * @author jhhong
 */
const ExpBlock = new mongoose.Schema({
  'nettype':    {type: String, index: {unique: true}}, // 체인타입: logistics / token
  'blockNumber': Number, // 블록넘버
  }, {collection: 'ExpBlock'},);
/**
 * @notice ExpTxLogistics Schema, 물류 트랜젝션 정보
 * @author jhhong
 */
const ExpTxLogistics = new mongoose.Schema({
  'hash':        {type: String, index: {unique: true}, lowercase: true}, // 트랜젝션 해시값, 유일값
  'from':        {type: String, lowercase: true}, // 트랜젝션 발행자 주소
  'to':          {type: String, lowercase: true}, // 트랜젝션 수신지 주소
  'blockNumber':  Number, // 블록넘버
  'code':         String, // 배송코드 (물류정보)
  'companyAddr':  String, // 담당 물류사 컨트랙트 주소 (물류정보)
  'companyName':  String, // 담당 물류사 이름 (물류정보)
  'creator'    :  String, // 트랜젝션 생성주체 (ie. 컨트랙트 deploy: from과 같다)
  'deployedType': String, // deploy된 컨트랙트의 타입 (service/company/order) (물류정보)
  'gas':          Number, // 가스 배정량
  'gasUsed':      Number, // 실제 가스 사용량
  'gasPrice':     String, // 가스 가격
  'nonce':        Number, // from의 트랜젝션 시퀀스값
  'orderAddr':    String, // 주문 컨트랙트 주소 (물류정보)
  'orderId':      String, // 주문번호 (물류정보)
  'param01':      String, // 부가적인 표현 데이터1 (OPTIONAL)
  'param02':      String, // 부가적인 표현 데이터2 (OPTIONAL)
  'serviceAddr':  String, // 서비스 컨트랙트 주소 (물류정보)
  'status':       String, // 트랜젝션 상태 (Success/Failed/Pending)
  'timestamp':    Number, // 트랜젝션 생성 timestamp
  'transportId':  String, // 운송번호 (물류정보)
  'txfee':        String, // 트랜젝션 수수료
  'txtype':       String, // 트랜젝션 타입 (물류정보)
  'value':        String, // 트랜젝션에서 이동되는 ETH양
}, {collection: 'ExpTxLogistics'},);
/**
 * @notice ExpTxToken Schema, 토큰관련 트랜젝션 정보
 * @author jhhong
 */
const ExpTxToken = new mongoose.Schema({
  'hash':        {type: String, index: {unique: true}, lowercase: true}, // 트랜젝션 해시값, 유일값
  'from':        {type: String, lowercase: true}, // 트랜젝션 발행자 주소
  'to':          {type: String, lowercase: true}, // 트랜젝션 수신지 주소 (토큰 컨트랙트 주소)
  'origin':      {type: String, lowercase: true}, // 토큰 송신지 주소
  'dest':        {type: String, lowercase: true}, // 토큰 수신지 주소
  'amount':       String, // 트랜젝션에서 이동되는 DKA양
  'blockNumber':  Number, // 블록넘버
  'creator'    :  String, // 트랜젝션 생성주체 (ie. 컨트랙트 deploy: from과 같다)
  'deployedType': String, // deploy된 컨트랙트의 타입 (token)
  'gas':          Number, // 가스 배정량
  'gasUsed':      Number, // 실제 가스 사용량
  'gasPrice':     String, // 가스 가격
  'nonce':        Number, // from의 트랜젝션 시퀀스값
  'status':       String, // 트랜젝션 상태 (Success/Failed/Pending)
  'timestamp':    Number, // 트랜젝션 생성 timestamp
  'tokenAddr':    String, // 토큰 컨트랙트 주소
  'txfee':        String, // 트랜젝션 수수료
  'txtype':       String, // 트랜젝션 타입 (토큰 전송정보)
  'value':        String, // 트랜젝션에서 이동되는 ETH양
}, {collection: 'ExpTxToken'},);
/**
 * @notice ExpOrderTrack Schema, 주문의 구간전송 정보
 * @author jhhong
 */
const ExpOrderTrack = new mongoose.Schema({
  'code':         String, // 배송코드 (물류정보)
  'companyAddr':  String, // 담당 물류사 컨트랙트 주소 (물류정보)
  'companyName':  String, // 담당 물류사 이름 (물류정보)
  'incentives':   String, // 운송번호 (물류정보)
  'orderAddr':    String, // 주문 컨트랙트 주소 (물류정보)
  'orderId':      String, // 주문번호 (물류정보)
  'transportId':  String, // 운송번호 (물류정보)
  'blockNumber':  Number, // 블록넘버, 정보의 투명성 보장 (Ref. getStartBlock)
}, {collection: 'ExpOrderTrack'});
/**
 * @notice ExpEvtLogistics Schema, 트랜젝션에 포함된 이벤트 로그 정보
 * @author jhhong
 */
const ExpEvtLogistics = new mongoose.Schema({
  'txHash':     {type: String, lowercase: true}, // 트랜젝션 해시값
  'eventName':   String, // 이벤트명
  'paramCount':  Number, // 이벤트 파라메터 갯수
  'paramName01': String, // 이벤트 파라메터01의 이름
  'paramName02': String, // 이벤트 파라메터02의 이름
  'paramName03': String, // 이벤트 파라메터03의 이름
  'paramName04': String, // 이벤트 파라메터04의 이름
  'paramType01': String, // 이벤트 파라메터01의 타입
  'paramType02': String, // 이벤트 파라메터02의 타입
  'paramType03': String, // 이벤트 파라메터03의 타입
  'paramType04': String, // 이벤트 파라메터04의 타입
  'paramData01': String, // 이벤트 파라메터01 데이터
  'paramData02': String, // 이벤트 파라메터02 데이터
  'paramData03': String, // 이벤트 파라메터03 데이터
  'paramData04': String, // 이벤트 파라메터04 데이터
}, {collection: 'ExpEvtLogistics'});
/**
 * @notice ExpEvtToken Schema, 트랜젝션에 포함된 이벤트 로그 정보
 * @author jhhong
 */
const ExpEvtToken = new mongoose.Schema({
  'txHash':     {type: String, lowercase: true}, // 트랜젝션 해시값
  'eventName':   String, // 이벤트명
  'paramCount':  Number, // 이벤트 파라메터 갯수
  'paramName01': String, // 이벤트 파라메터01의 이름
  'paramName02': String, // 이벤트 파라메터02의 이름
  'paramName03': String, // 이벤트 파라메터03의 이름
  'paramName04': String, // 이벤트 파라메터04의 이름
  'paramType01': String, // 이벤트 파라메터01의 타입
  'paramType02': String, // 이벤트 파라메터02의 타입
  'paramType03': String, // 이벤트 파라메터03의 타입
  'paramType04': String, // 이벤트 파라메터04의 타입
  'paramData01': String, // 이벤트 파라메터01 데이터
  'paramData02': String, // 이벤트 파라메터02 데이터
  'paramData03': String, // 이벤트 파라메터03 데이터
  'paramData04': String, // 이벤트 파라메터04 데이터
}, {collection: 'ExpEvtToken'});
ExpOrderTrack.index({'orderAddr': 1, 'transportId': 1}, {unique: true}); // 다중 키 인덱싱 - 주문 안에서 운송번호는 유일하다..
mongoose.set('useCreateIndex', true); // warning 제거:DeprecationWarning: collection.ensureIndex is deprecated. ...
mongoose.set('useFindAndModify', false); // warning 제거:DeprecationWarning: Mongoose: `findOneAndUpdate()` and `findOneAndDelete()` ...
mongoose.model('ExpBlock', ExpBlock); // 스키마 등록 (ExpBlock)
mongoose.model('ExpTxLogistics', ExpTxLogistics); // 스키마 등록 (ExpTxLogistics)
mongoose.model('ExpTxToken', ExpTxToken); // 스키마 등록 (ExpTxToken)
mongoose.model('ExpOrderTrack', ExpOrderTrack); // 스키마 등록 (ExpOrderTrack)
mongoose.model('ExpEvtLogistics', ExpEvtLogistics); // 스키마 등록 (ExpEvtLogistics)
mongoose.model('ExpEvtToken', ExpEvtToken); // 스키마 등록 (ExpEvtToken)
module.exports.ExpBlock        = mongoose.model('ExpBlock'); // module.exports
module.exports.ExpTxLogistics  = mongoose.model('ExpTxLogistics'); // module.exports
module.exports.ExpTxToken      = mongoose.model('ExpTxToken'); // module.exports
module.exports.ExpOrderTrack   = mongoose.model('ExpOrderTrack'); // module.exports
module.exports.ExpEvtLogistics = mongoose.model('ExpEvtLogistics'); // module.exports
module.exports.ExpEvtToken     = mongoose.model('ExpEvtToken'); // module.exports
mongoose.Promise = global.Promise; // nodejs의 기본 프로미스 (global.Promise)를 사용

/**
 * @notice mongoose DB 접속 수행
 * @dev 차후 DB 접근권한도 설정해야 함
 * user: 'explorer', pass: 'yourdbpasscode'
 * mongoose.set('debug', true) 기능 확인 필요
 * @author jhhong
 */
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost/dkargoDB', {
    useNewUrlParser: true, // warning 제거: DeprecationWarning: current URL string parser is deprecated
    useUnifiedTopology: true // warning 제거: DeprecationWarning: current Server Discovery and Monitoring engine is deprecated
});