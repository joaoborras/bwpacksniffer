//*********************** variables and objects used in the proxy ******************
//no final, o object credentials sera um array porque vai ter varias ZD's apps conectando no proxy
var credentials = [{
	//url: 'xsp1.pbxl.net', <-- no need as it will be fixed for all apps
	username: 'BWS_Test.zentestuser1@pbxl.net',
	password: 'Borras123',
	appId: '',
	callhalf: '',
	subscriptionId: '',
	channelId: '', //probably will be necessary in the very near future....
	zddomain: '',
},
{
	//url: 'xsp1.pbxl.net', <-- no need as it will be fixed for all apps
	username: 'BWS_Test.zentestuser2@pbxl.net',
	password: 'Borras123',
	appId: '',
	callhalf: '',
	subscriptionId: '',
	channelId: '', //probably will be necessary in the very near future....
	zddomain: '',
}];

//this array stores all the BW groups from all clients. A subscription must be opened for each one
var BW_groups = ['PBXL_Test',];

//this object stores data related to BW for each ZD's app. These data are unique to the application
//as there is only one channel and subscription, that will receive all events from BW related to 
//all opened calls
var bwconnection = {
	applicationId: 'bweventsniffer',
	channelSetId: 'bweventsnifferchannelset',
	channelId: '',
	heartbeatIntervalId: '', //TODO: this variable is global as there is only 1 streaming http
	subscriptionId: '',
	callhalf: '',
};

//**************** global constants to be used by all ZD's apps *********************
var HEARTBEAT_INTERVAL = 15000;
var BW_URL = 'xsp1.pbxl.net';
var ZD_URL = 'pbxltest.zendesk.com';
var EVENT_CLOSE = '</xsi:Event>';
var CHANNEL_CLOSE = '</Channel>';
var HEARTBEAT_CLOSE = '<ChannelHeartBeat xmlns="http://schema.broadsoft.com/xsi"/>';

//****************** required objects and libs ***********************
var express = require('express');
var http = require('http');
var path = require('path');
//var https = require('https'); //the main http session(streaming http)
var app = express();
var parseString = require('xml2js').parseString;
var DOMParser = require('xmldom').DOMParser;
var fs = require('fs');
var Log = require('log');
var log = new Log('debug', fs.createWriteStream('snifferlog.txt', {'flags':'a'}));

//******************* setup the proxy ***********************
// all environments
app.set('port', process.env.PORT || 3000);
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());

app.use(express.static(path.join(__dirname, 'public')));

app.use(app.router);

// development only
if ('development' == app.get('env')) {
	app.use(express.errorHandler());
}

//******************* commands from client(ZD app or test web page) ************************
app.all('*', function(req, res, next){
  	res.header("Access-Control-Allow-Origin", "https://pbxltest.zendesk.com");
  	res.header("Access-Control-Allow-Headers", "X-Requested-With, Access-Control-Allow-Credentials, Authorization");
  	res.header("Access-Control-Allow-Credentials", true);
  	next();
 });

app.all("/log_in/", function(req, res){
	console.log("/register_user/ received " + req.query);
	log.info(", username: " + req.param('username') + 
		     ", password: " + req.param('password') + 
		     ", appId: " + req.param('appid') + 
		     ", zddomain: " + req.param('zedomain') + '\r\n');

	res.writeHead(200, {'Content-Type': 'text/plain'});
  	res.end();
	for(var index in credentials){
		if(credentials[index].username === req.param('username')){
			credentials[index].appId = req.param('appid');
			credentials[index].zddomain = req.param('zddomain');
			sendSignedInToZdApp(credentials[index].zddomain, credentials[index].appId, 'signedIn');
		}else{ //this user is not registered so, send back an error message to check the credentials
			sendSignInErrorToZD(req.param('zddomain'), req.param('appid'));
		}
	}
});

app.all("/make_call/", function(req, res){
	console.log("/make_call/ received " + req.query);
	res.send("Received your request to make a call to " + req.param('destination') + ". Now, wait a bit!");
	makeCall(req.param('destination'),req.param('username'));
});

app.all('/accept_call', function(req, res){
	console.log("/accept_call/ received" + req.query);
	res.send("Answering the call...");
	acceptCall(req.param('username'));
});

app.all('/disconnect_call/', function(req, res){
	console.log("/disconnect_call/ received" + req.query);
	res.send("Disconnecting call...")
	disconnectCall(req.param('username'));
});

app.all('/reject_call/', function(req, res){
	console.log("/reject_call/ received" + req.query);
	res.send("Rejecting call...")
	rejectCall(); //TODO: implement rejectCall();
});

//********************** event processing work functions *************************
getName = function(){
	console.log("INFO: getName ->");
	var options = {
	  host: BW_URL,
	  path: "/com.broadsoft.xsi-actions/v2.0/user/" + credentials.username + "/profile",
	  method: 'GET',
	  auth: credentials.username + ':' + credentials.password
	};
	var http = require('http');
	var req = http.request(options, function(res) {
	  log.info("< response from BW: " + res.statusCode + '\r\n');
	  if(res.statusCode === 200){
	  	requestChannel();
	  }else{
	  	sendSignInErrorToZD(credentials.appId);
	  }
	});

	req.on('error', function(e) {
  		log.info('problem with request: ' + e.message + '\r\n');
	});

	req.end();
	log.info('> GET ' + BW_URL + "/com.broadsoft.xsi-actions/v2.0/user/" + credentials.username + "/profile \r\n");
};

//TODO: probably, will have to open one channel for each user...
//if so, the function must receive the username and password.
requestChannel = function(){
	console.log("INFO: requestChannel ->");
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.async/com.broadsoft.xsi-events/v2.0/channel",
		method: 'POST',
		//auth: username + ':' + password,
		auth: 'jp_zentest@pbxl.net:Borras123',
		headers: {'Content-Type': 'text/xml'}
	};
	var req = http.request(options, function(res){
		log.info("<- response from BW: " + res.statusCode + '\r\n');
		if(res.statusCode != 200){
			console.log("Error in requestChannel. Response status is " + res.statusCode);
			console.log("Will try again...");
			log.error("<- response from BW: " + res.statusCode + '\r\n');
			log.info("Will try again...");
			requestChannel();
		}
		res.setEncoding('utf8');
		var resbody = "";
		res.on('data', function (chunk) {
			console.log(chunk + '\r\n' + '\r\n');
			log.info("< " + chunk + '\r\n');
        	resbody += chunk;
        	if(resbody.indexOf(EVENT_CLOSE) >= 0 || resbody.indexOf(CHANNEL_CLOSE) >= 0 || resbody.indexOf(HEARTBEAT_CLOSE) >= 0){
				parseChunk(resbody);
				resbody = ""; //prepares to receive a new event, if any!
			}else if(resbody.indexOf('<ChannelHeartBeat ') >= 0){
				//do nothing here as it is only answer from the heartbeat command
			}
    	});
		res.on('end',function(){
			/*console.log("   response data: " + resbody);
			parseString(resbody, function (err, result) {
			    console.log("   Response's body: " + result);
			});*/
		});
		res.on('error', function(e){
			console.log("Error on requestChannel. Status is " + e.status);
			console.log("Error message: " + e.message);
			console.log("Will try again...");
			requestChannel();
		});
	});

	req.on('error', function(e) {
  		console.log('problem with requestChannel request: ' + e.message);
	});
	console.log("channelSetId in requestChannel function is " + bwconnection.channelSetId);
	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
		xml_data = xml_data + '<Channel xmlns="http://schema.broadsoft.com/xsi">';
		xml_data = xml_data + '<channelSetId>' + bwconnection.channelSetId + '</channelSetId>';
		xml_data = xml_data + '<priority>1</priority>';
		xml_data = xml_data + '<weight>100</weight>';
		xml_data = xml_data + '<expires>3600</expires>';
		xml_data = xml_data + '<applicationId>' + bwconnection.applicationId + '</applicationId>';
		xml_data = xml_data + '</Channel>';

	req.write(xml_data);
	req.end();
	log.info('> POST ' + BW_URL + '/com.broadsoft.async/com.broadsoft.xsi-events/v2.0/channel \r\n' + xml_data + '\r\n');
};

startHeartbeat = function(channelid){
	console.log("INFO: startHeartbeat ->");
	var options = {
	  host: BW_URL,
	  path: '/com.broadsoft.xsi-events/v2.0/channel/' + channelid + "/heartbeat",
	  method: 'PUT',
	  //auth: username + ':' + password
	  auth: 'jp_zentest@pbxl.net:Borras123' //the correct is the above!!!
	};
	var http = require('http');
	var req = http.request(options, function(res) {
	  log.info("< response from BW on heartbeat: " + res.statusCode + '\r\n');
	});

	req.on('error', function(e) {
  		console.log('problem with heartbeat request: ' + e.message);
	});

	req.end();
	log.info('> PUT ' + BW_URL + '/com.broadsoft.xsi-events/v2.0/channel/' + bwconnection.channelId + "/heartbeat \r\n");

	heartbeatIntervalId = setTimeout(function(){
		if(bwconnection.channelId != ''){
			startHeartbeat();
		}else{
			//if there is no channel, then start again from requesting a new one
			requestChannel();
		}
	}, HEARTBEAT_INTERVAL);
};

//need to make a subscription for each user registered
eventSubscription = function(event, username, password){
	console.log("INFO: eventSubscription to " + username + " ->");
	var options = {
		host: BW_URL,
		//path: "/com.broadsoft.xsi-events/v2.0/user/" + username,
		path: "/com.broadsoft.xsi-events/v2.0/serviceprovider/PBXL%20Inc./group/PBXL_Test",
		method: 'POST',
		auth: 'jp_zentest@pbxl.net:Borras123',
		headers: {'Content-Type': 'text/xml'}
	};
	var http = require('http');
	var req = http.request(options, function(res){
		console.log("<- response from BW: " + res.statusCode);
		res.setEncoding('utf8');
		var resbody = "";
		res.on('data', function (chunk) {
			log.info('< ' + chunk + '\r\n');
    	});
		res.on('end',function(){
			//TODO
		});

	});

	req.on('error', function(e) {
  		console.log('problem with request: ' + e.message);
	});

	console.log("channelSetId in eventSubscription function is " + bwconnection.channelSetId);
	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
	xml_data = xml_data + '<Subscription xmlns=\"http://schema.broadsoft.com/xsi\">';
	xml_data = xml_data + "<event>" + event + "</event>";
	xml_data = xml_data + "<expires>3600</expires>";
	xml_data = xml_data + "<channelSetId>" + bwconnection.channelSetId + "</channelSetId>";
	xml_data = xml_data + '<applicationId>' + bwconnection.applicationId + '</applicationId>';
	xml_data = xml_data + "</Subscription>";

	req.write(xml_data);
	req.end();
	log.info('> POST ' + BW_URL + "/com.broadsoft.xsi-events/v2.0/serviceprovider/PBXL%20Inc./group/PBXL_Test" + '\r\n' + xml_data + '\r\n');
};

sendResponseEvent = function(eventId){
	console.log("INFO: sendResponseEvent ->");
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.xsi-events/v2.0/channel/eventresponse",
		method: 'POST',
		auth: 'jp_zentest@pbxl.net:Borras123',
		//auth: username + ':' + password,
		headers: {'Content-Type': 'text/xml'}
	};
	var http = require('http');
	var req = http.request(options, function(res){
		//console.log("<- response from BW: " + res.statusCode);
	});

	req.on('error', function(e) {
  		console.log('   problem with sendResponseEvent request: ' + e.message);
	});

	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
		xml_data = xml_data + "<EventResponse xmlns=\"http://schema.broadsoft.com/xsi\">";
		xml_data = xml_data + "<eventID>" + eventId + "</eventID>";
		xml_data = xml_data + "<statusCode>200</statusCode>";
		xml_data = xml_data + "<reason>OK</reason>";
		xml_data = xml_data + "</EventResponse>";

	req.write(xml_data);
	req.end();

	log.info('> POST ' + BW_URL + "/com.broadsoft.xsi-events/v2.0/channel/eventresponse \r\n" + xml_data + '\r\n');
};

parseChunk = function(chunk){ //chunk is already string
	//now, look for what kind of event we received
	if(chunk.indexOf('<Channel ') >= 0){ //<Channel event
		parseString(chunk, function(err, result){
			bwconnection.channelId = result.Channel.channelId;
			//start heartbeat
			startHeartbeat(result.Channel.channelId);
			eventSubscription('Advanced Call', 'jp_zentest@pbxl.net', 'Borras123');
		});
	}else if(chunk.indexOf('<ChannelHeartBeat ') >= 0){
		//TODO: for now do nothing as it is only answer from heartbeat
	}else if(chunk.indexOf('ChannelTerminatedEvent') >= 0){
		console.log("WARNING: ChannelTerminatedEvent <-");
		bwconnection.channelId = '';
	}else if(chunk.indexOf('<xsi:Event ') >= 0){//xsi:Event received. Now see if it is channel disconnection
		//for every xsi:Event, needs to send event Response
		var xmldoc = new DOMParser().parseFromString(chunk,'text/xml');	
		var eventid = xmldoc.getElementsByTagName('xsi:eventID').item(0).firstChild.nodeValue;
		sendResponseEvent(eventid);
		var userid = xmldoc.getElementsByTagName('xsi:userId').item(0).firstChild.nodeValue;
		var targetid = xmldoc.getElementsByTagName('xsi:targetId').item(0).firstChild.nodeValue;
		var remoteparty = xmldoc.getElementsByTagName('xsi:address').item(0).firstChild.nodeValue.substring(5);
		var eventType = xmldoc.getElementsByTagName('xsi:eventData').item(0).getAttribute('xsi1:type').trim();
		eventType = eventType.substring(4);//string off the prefix "xsi:" from the eventType
		switch(eventType){
			case 'CallReceivedEvent':
				var countrycode = xmldoc.getElementsByTagName('xsi:address').item(0).getAttribute('countryCode');
				if(remoteparty.indexOf(countrycode) >= 0){
					remoteparty = remoteparty.replace(countrycode, '0');
				}
				console.log("INFO: CallReceived(from: " + remoteparty + " to: " + targetid + ") <-");
				break;
			case 'CallAnsweredEvent':
				console.log("INFO: CallAnsweredEvent(userid: " + remoteparty + ") <-");
				break;
			case 'CallReleasedEvent':
				console.log("INFO: CallReleasedEvent(userid: " + remoteparty + ") <-");
				break;
			case 'CallUpdatedEvent':
				console.log("INFO: CallUpdatedEvent <-");
				break;
			case 'CallSubscriptionEvent':
				console.log("INFO: CallSubscriptionEvent <-");
				break;
			case 'CallOriginatedEvent':
				console.log("INFO: CallOriginatedEvent(from: " + targetid + " to: " + remoteparty + ") <-");
				break;
			case 'CallRetrievedEvent':
				console.log("INFO: CallRetrievedEvent(userid: " + remoteparty + ") <-");
				break;
			case 'CallHeldEvent':
				console.log('INFO: CallHelEvent <-');
				break;
			case 'CallTransferredEvent':
				console.log('INFO: CallTransferredEvent <-');
				break;
			case 'CallRedirectedEvent':
				console.log('INFO: CallRedirectedEvent');
				break;
			case 'CallHeldEvent':
			case 'DoNotDisturbEvent':
			case 'CallForwardingAlwaysEvent':
			case 'RemoteOfficeEvent':
				break;
			default:
		}
	}
};

//**************** listen for incoming events ***********************
requestChannel();