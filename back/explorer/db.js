/**
 * @file db.js
 * @notice DB (mongoose) schema 정의 및 구동 파일
 * @author jhhong
 */
const mongoose = require('mongoose');
/**
 * @notice Block Schema, 블록 정보, explorer가 갱신
 * @author jhhong
 */
const ExpBlock = new mongoose.Schema({
  'nettype':    {type: String, index: {unique: true}}, // 체인타입: logistics / token
  'blockNumber': Number, // 블록넘버
  }, {collection: 'ExpBlock'},);
/**
 * @notice TxLogistics Schema, 물류 트랜젝션 정보, explorer가 갱신
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
  'serviceAddr':  String, // 서비스 컨트랙트 주소 (물류정보)
  'status':       Number, // 트랜젝션 상태 (성공/실패/pending)
  'timestamp':    Number, // 트랜젝션 생성 timestamp
  'transportId':  String, // 운송번호 (물류정보)
  'txfee':        String, // 트랜젝션 수수료
  'txtype':       String, // 트랜젝션 타입 (물류정보)
  'value':        String, // 트랜젝션에서 이동되는 ETH양
}, {collection: 'ExpTxLogistics'},);
/**
 * @notice TxToken Schema, 토큰전송 트랜젝션 정보, explorer가 갱신
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
  'status':       Number, // 트랜젝션 상태 (성공/실패/pending)
  'timestamp':    Number, // 트랜젝션 생성 timestamp
  'tokenAddr':    String, // 토큰 컨트랙트 주소
  'txfee':        String, // 트랜젝션 수수료
  'txtype':       String, // 트랜젝션 타입 (토큰 전송정보)
  'value':        String, // 트랜젝션에서 이동되는 ETH양
}, {collection: 'ExpTxToken'},);
/**
 * @notice OrderTrack Schema, 주문의 구간전송 정보, explorer가 갱신
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
ExpOrderTrack.index({'orderAddr': 1, 'transportId': 1}, {unique: true}); // 다중 키 인덱싱 - 주문 안에서 운송번호는 유일하다..
mongoose.set('useCreateIndex', true); // warning 제거:DeprecationWarning: collection.ensureIndex is deprecated. ...
mongoose.set('useFindAndModify', false); // warning 제거:DeprecationWarning: Mongoose: `findOneAndUpdate()` and `findOneAndDelete()` ...
mongoose.model('ExpBlock', ExpBlock); // 스키마 등록 (ExpBlock)
mongoose.model('ExpTxLogistics', ExpTxLogistics); // 스키마 등록 (ExpTxLogistics)
mongoose.model('ExpTxToken', ExpTxToken); // 스키마 등록 (ExpTxToken)
mongoose.model('ExpOrderTrack', ExpOrderTrack); // 스키마 등록 (ExpOrderTrack)
module.exports.ExpBlock       = mongoose.model('ExpBlock'); // module.exports
module.exports.ExpTxLogistics = mongoose.model('ExpTxLogistics'); // module.exports
module.exports.ExpTxToken     = mongoose.model('ExpTxToken'); // module.exports
module.exports.ExpOrderTrack  = mongoose.model('ExpOrderTrack'); // module.exports
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