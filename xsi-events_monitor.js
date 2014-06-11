//*********************** variables and objects used in the proxy ******************
//no final, o object credentials sera um array porque vai ter varias ZD's apps conectando no proxy
var credentials = [{
		username: 'BWS_Test.zentestuser1@pbxl.net',
		password: 'Borras123',
	},
	{
		username: 'BWS_Test.zentestuser2@pbxl.net',
		password: 'Borras123',	
	}
];

//this array stores all the BW groups from all clients. A subscription must be opened for each one
var BW_groups = ['PBXL_Test',];

//this object stores data related to BW for each ZD's app. These data are unique to the application
//as there is only one channel and subscription, that will receive all events from BW related to 
//all opened calls
var bwconnection = {
	applicationId: 'xsisnifferchannel',
	channelSetId: 'xsisnifferchannelset',
	channelId: '',
	heartbeatIntervalId: '',
	channelUpdateIntervalId: '',
	subscriptionId: '',
	subscriptionUpdateIntervalId: '',
	callhalf: '',
	groupadmin: 'jp_zentest@pbxl.net',
	groupadminpassword: 'Borras123',
	serviceprovider: 'PBXL%20Inc.',
	groupId: 'PBXL_Test',
};

//**************** global constants to be used by all ZD's apps *********************
var HEARTBEAT_INTERVAL = 15000;
var CHANNEL_UPDATE_INTERVAL = 1800000;
var SUBSCRIPTION_UPDATE_INTERVAL = 1600000;
var BW_URL = 'xsp1.pbxl.net';
var SUBSCRIPTION_CLOSE = '</Subscription>';
var EVENT_CLOSE = '</xsi:Event>';
var CHANNEL_CLOSE = '</Channel>';
var HEARTBEAT_CLOSE = '<ChannelHeartBeat xmlns="http://schema.broadsoft.com/xsi"/>';

//****************** required objects and libs ***********************
require('monitor').start();
var express = require('express');
var http = require('http'); //http object used to connect the proxy with BW server
var path = require('path');
var app = express();
var parseString = require('xml2js').parseString;
var DOMParser = require('xmldom').DOMParser;
var fs = require('fs');
var Log = require('log');
var log = new Log('debug', fs.createWriteStream('xsi-events-monitor_log.txt', {'flags':'a'}));

//******************* setup the proxy ***********************
// all environments
app.set('port', process.env.PORT || 5000);
app.set('views', __dirname + '/views');
app.engine('html', require('ejs').renderFile);
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
//TODO: the Access-Control is not working -> have to check it
app.all('*', function(req, res, next){
  	//res.header("Access-Control-Allow-Origin", "https://pbxltest.zendesk.com");
  	//res.header("Access-Control-Allow-Origin", "https://ap.salesforce.com");
  	res.header("Access-Control-Allow-Origin", "*");
  	res.header("Access-Control-Allow-Headers", "X-Requested-With, Access-Control-Allow-Credentials, Authorization");
  	res.header("Access-Control-Allow-Credentials", true);
  	next();
 });

app.all('/', function(req, res, next){
  	console.log("/ received " + req.query);
  	log.info('<- / received ');
	res.send('nothing here for you...');
 });

//connect to be used for some web app to receive and display xsi events
app.post("/connect/", function(req, res){
	var username = req.param('username');
	console.log("<- /connect/ called from user " + username);
	log.info('<- /connect/ called from user ' + username);
	for(var index in credentials){
		if(credentials[index].username == username){
			console.log("found user " + username + " in credentials and will now connect it");
			credentials[index].appId = res;
			var connectresponse = '<Event>';
			connectresponse += '<eventtype>ConnectResponse</eventtype>';
			connectresponse += '</Event>';
			console.log("-> ConnectResponse to SFDC(" + username + ")");
			log.info("-> ConnectResponse to SFDC(" + username + ")");
			res.setHeader('Content-Type', 'text/xml; charset=UTF-8');
			res.setHeader('Transfer-Encoding', 'chunked');
			res.write(connectresponse, 'utf8');
		}else{
			console.log("Username " + username + " not in credentials");
		}
	}
});

//********************** event processing work functions *************************
requestChannel = function(){
	console.log("-> INFO: requestChannel");
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.async/com.broadsoft.xsi-events/v2.0/channel",
		method: 'POST',
		auth: bwconnection.groupadmin + ':' + bwconnection.groupadminpassword,
		headers: {'Content-Type': 'text/xml'}
	};
	var req = http.request(options, function(res){
		if(res.statusCode != 200 && res.statusCode != 401 && res.statusCode != 403){//not auth problem
			console.log("Error in requestChannel. Response status is " + res.statusCode);
			log.error("<- response from BW: " + res.statusCode + '\r\n');
			console.log("Will try again in 5 secs...");
			log.info("Will try again in 5 secs...");
			setTimeout(function(){
				requestChannel();
			},5000);
		}
		res.setEncoding('utf8');
		var resbody = "";
		res.on('data', function (chunk) {
			log.info("<- " + chunk + '\r\n');
			console.log(chunk);
        	resbody += chunk;
        	if(resbody.indexOf(EVENT_CLOSE) >= 0 || resbody.indexOf(CHANNEL_CLOSE) >= 0 || 
        		resbody.indexOf(HEARTBEAT_CLOSE) >= 0 || resbody.indexOf(SUBSCRIPTION_CLOSE) >= 0){
				parseChunk(resbody);
				resbody = ""; //prepares to receive a new event, if any!
			}else if(resbody.indexOf('<ChannelHeartBeat ') >= 0){
				//do nothing here as it is only answer from the heartbeat command
			}
    	});
		res.on('error', function(e){
			console.log("Error on requestChannel. Status is " + e.status);
			console.log("Error message: " + e.message);
			console.log("Will try again...");
			requestChannel();
		});
		res.on('close', function(e){
			console.log("ERROR: Main connection closed.");
			log.error("Main connection closed.");
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
	log.info('-> POST ' + BW_URL + '/com.broadsoft.async/com.broadsoft.xsi-events/v2.0/channel \r\n' + xml_data + '\r\n');
};

updateChannel = function(){
	console.log("-> INFO: updateChannel ID " + bwconnection.channelId);
	log.info("-> updateChannel ID " + bwconnection.channelId);
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.xsi-events/v2.0/channel/" + bwconnection.channelId,
		method: 'PUT',
		auth: bwconnection.groupadmin + ':' + bwconnection.groupadminpassword,
		headers: {'Content-Type': 'text/xml'}
	};
	var http = require('http');
	var req = http.request(options, function(res){
		if(res.statusCode != 200){
			console.log("Error in updateChannel. Response status is " + res.statusCode);
			log.error("<- response from BW: " + res.statusCode + '\r\n');
		}
	});
	req.on('error', function(e) {
  		console.log('problem with updateChannel request: ' + e.message);
	});
	console.log("channelSetId in requestChannel function is " + bwconnection.channelSetId);
	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
		xml_data = xml_data + '<Channel xmlns="http://schema.broadsoft.com/xsi">';
		xml_data = xml_data + '<expires>3800</expires>';
		xml_data = xml_data + '</Channel>';

	req.write(xml_data);
	req.end();
	log.info('-> POST ' + BW_URL + '/com.broadsoft.xsi-events/v2.0/channel/' + bwconnection.channelId + '\r\n' + xml_data + '\r\n');
};

startHeartbeat = function(){
	if(bwconnection.channelId != ''){
		console.log("-> INFO: startHeartbeat");
		var options = {
		  host: BW_URL,
		  path: '/com.broadsoft.xsi-events/v2.0/channel/' + bwconnection.channelId + "/heartbeat",
		  method: 'PUT',
		  auth: bwconnection.groupadmin + ':' + bwconnection.groupadminpassword,
		};
		var http = require('http');
		var req = http.request(options, function(res) {
			if(res.statusCode != 200){//some problems happened with the channel. Open a new one
				log.error("<- response from BW on heartbeat: " + res.statusCode + '\r\n');
				requestChannel();
			}
		  	log.info("<- response from BW on heartbeat: " + res.statusCode + '\r\n');
		});

		req.on('error', function(e) {
	  		console.log('problem with heartbeat request: ' + e.message);
		});

		req.end();
		log.info('-> PUT ' + BW_URL + '/com.broadsoft.xsi-events/v2.0/channel/' + bwconnection.channelId + "/heartbeat \r\n");
	}else{
		console.log("WARNING: now heartbeat sent as there is no channel openned");
		log.warning("WARNING: now heartbeat sent as there is no channel openned");
	}
};

//need to make a subscription for each user registered
eventSubscription = function(event){
	console.log("-> INFO: eventSubscription");
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.xsi-events/v2.0/serviceprovider/" + bwconnection.serviceprovider + 
			  "/group/" + bwconnection.groupId,
		method: 'POST',
		auth: bwconnection.groupadmin + ':' + bwconnection.groupadminpassword,
		headers: {'Content-Type': 'text/xml'}
	};
	var http = require('http');
	var req = http.request(options, function(res){
		if(res.statusCode != 200){
			console.log("ERROR: <- Subscription response from BW: " + res.statusCode);
			log.error("<- Subscription response from BW: " + res.statusCode);
		}else{
			res.setEncoding('utf8');
			res.on('data', function(response){
				console.log("<- Subscription Response: " + response + '\r\n');
				log.info("<- Subscription Response: " + response + '\r\n');
				var xmldoc = new DOMParser().parseFromString(response,'text/xml');	
				bwconnection.subscriptionId = xmldoc.getElementsByTagName('subscriptionId').item(0).firstChild.nodeValue;	
				bwconnection.subscriptionUpdateIntervalId = setInterval(updateSubscription, SUBSCRIPTION_UPDATE_INTERVAL);
			})
		}		
	});

	req.on('error', function(e) {
  		console.log('problem with request: ' + e.message);
	});

	console.log("channelSEtId in eventSubscription function is " + bwconnection.channelSetId);
	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
	xml_data = xml_data + '<Subscription xmlns=\"http://schema.broadsoft.com/xsi\">';
	xml_data = xml_data + "<event>" + event + "</event>";
	xml_data = xml_data + "<expires>3600</expires>";
	xml_data = xml_data + "<channelSetId>" + bwconnection.channelSetId + "</channelSetId>";
	xml_data = xml_data + '<applicationId>' + bwconnection.applicationId + '</applicationId>';
	xml_data = xml_data + "</Subscription>";

	req.write(xml_data);
	req.end();
	log.info('-> POST ' + BW_URL + "/com.broadsoft.xsi-events/v2.0/serviceprovider/" + bwconnection.serviceprovider + "/group/" + bwconnection.groupId + '\r\n' + xml_data + '\r\n');
};

updateSubscription = function(){
	console.log("-> INFO: updateSubscription ID " + bwconnection.subscriptionId);
	log.info("-> updateSubscription ID " + bwconnection.subscriptionId);
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.xsi-events/v2.0/subscription/" + bwconnection.subscriptionId ,
		method: 'PUT',
		auth: bwconnection.groupadmin + ':' + bwconnection.groupadminpassword,
		headers: {'Content-Type': 'text/xml'}
	};
	var http = require('http');
	var req = http.request(options, function(res){
		if(res.statusCode != 200){
			console.log("<- Subscription Update response from BW: " + res.statusCode);
			log.error("<- Subscription Update response from BW: " + res.statusCode);
		}
	});

	req.on('error', function(e) {
  		console.log('problem with request: ' + e.message);
	});

	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
	xml_data = xml_data + '<Subscription xmlns=\"http://schema.broadsoft.com/xsi\">';
	xml_data = xml_data + "<expires>3800</expires>";
	xml_data = xml_data + "</Subscription>";

	req.write(xml_data);
	req.end();
	log.info('-> POST ' + BW_URL + "/com.broadsoft.xsi-events/v2.0/subscription/" + bwconnection.subscriptionId + '\r\n' + xml_data + '\r\n');
};

userSubscription = function(username, password, event, callback){
	console.log("-> INFO: userSubscription");
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.xsi-events/v2.0/user/" + username,
		method: 'POST',
		auth: 'jp_zentest@pbxl.net' + ':' + 'Borras123',
		headers: {'Content-Type': 'text/xml'}
	};
	var http = require('http');
	var req = http.request(options, function(res){
		if(res.statusCode != 200){
			console.log("ERROR: <- Subscription response from BW: " + res.statusCode);
			log.error("<- Subscription response from BW: " + res.statusCode);
		}else{
			res.setEncoding('utf8');
			res.on('data', function(response){
				console.log("<- Subscription Response: " + response + '\r\n');
				log.info("<- Subscription Response: " + response + '\r\n');
				//var xmldoc = new DOMParser().parseFromString(response,'text/xml');	
				//bwconnection.subscriptionId = xmldoc.getElementsByTagName('subscriptionId').item(0).firstChild.nodeValue;	
				//bwconnection.subscriptionUpdateIntervalId = setInterval(updateSubscription, SUBSCRIPTION_UPDATE_INTERVAL);
			})
		}
		callback(res.statusCode);		
	});

	req.on('error', function(e) {
  		console.log('problem with request: ' + e.message);
	});

	console.log("channelSEtId in eventSubscription function is " + bwconnection.channelSetId);
	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
	xml_data = xml_data + '<Subscription xmlns=\"http://schema.broadsoft.com/xsi\">';
	xml_data = xml_data + "<event>" + event + "</event>";
	xml_data = xml_data + "<expires>3600</expires>";
	xml_data = xml_data + "<channelSetId>" + bwconnection.channelSetId + "</channelSetId>";
	xml_data = xml_data + '<applicationId>' + bwconnection.applicationId + '</applicationId>';
	xml_data = xml_data + "</Subscription>";

	req.write(xml_data);
	req.end();
	log.info('-> POST ' + BW_URL + "/com.broadsoft.xsi-events/v2.0/user/" + username + '\r\n' + xml_data + '\r\n');
};

sendResponseEvent = function(eventId){
	console.log("-> INFO: sendResponseEvent");
	var options = {
		host: BW_URL,
		path: "/com.broadsoft.xsi-events/v2.0/channel/eventresponse",
		method: 'POST',
		auth: bwconnection.groupadmin + ':' + bwconnection.groupadminpassword,
		headers: {'Content-Type': 'text/xml'}
	};
	var http = require('http');
	var req = http.request(options, function(res){
		if(res.statusCode != 200){
			console.log("<- response from BW: " + res.statusCode);
			log.error("<- response from BW: " + res.statusCode);
		}
	});

	req.on('error', function(e) {
  		console.log('problem with sendResponseEvent request: ' + e.message);
	});

	var xml_data = '<?xml version="1.0" encoding="UTF-8"?>';
		xml_data = xml_data + "<EventResponse xmlns=\"http://schema.broadsoft.com/xsi\">";
		xml_data = xml_data + "<eventID>" + eventId + "</eventID>";
		xml_data = xml_data + "<statusCode>200</statusCode>";
		xml_data = xml_data + "<reason>OK</reason>";
		xml_data = xml_data + "</EventResponse>";

	req.write(xml_data);
	req.end();

	log.info('-> POST ' + BW_URL + "/com.broadsoft.xsi-events/v2.0/channel/eventresponse \r\n" + xml_data + '\r\n');
};

parseChunk = function(chunk){ //chunk is already string
	//now, look for what kind of event we received
	if(chunk.indexOf('<Channel ') >= 0){ //<Channel event
		parseString(chunk, function(err, result){
			bwconnection.channelId = result.Channel.channelId;
			//start heartbeat
			bwconnection.heartbeatIntervalId = setInterval(startHeartbeat, HEARTBEAT_INTERVAL);
			//channel events subscription
			eventSubscription('Advanced Call');
			//now, try subscribe for each user individually
			for(var x in credentials){
				var username = credentials[x].username;
				var password = credentials[x].password;
				userSubscription(username, password, 'Advanced Call', function(status){
					if(status == 200){
						console.log("Subscription ok");
					}
				});
			}

			//set interval for channel update
			bwconnection.channelUpdateIntervalId = setInterval(updateChannel, CHANNEL_UPDATE_INTERVAL);
		});
	}else if(chunk.indexOf('<ChannelHeartBeat ') >= 0){
		//TODO: for now do nothing as it is only answer from heartbeat
	}else if(chunk.indexOf('ChannelTerminatedEvent') >= 0){
		console.log("WARNING: ChannelTerminatedEvent <-");
		log.warning("ChannelTerminatedEvent <-");
		bwconnection.channelId = '';
		requestChannel();
	}else if(chunk.indexOf('SubscriptionTerminatedEvent') >= 0){//will open a new subscription
		console.log('WARNING: SubscriptionTerminatedEvent <-');
		log.warning('SubscriptionTerminatedEvent <-');
		bwconnection.subscriptionId = '';
	}else if(chunk.indexOf('<xsi:Event ') >= 0){//xsi:Event received. Now see if it is channel disconnection
		//for every xsi:Event, needs to send event Response
		try{
			var xmldoc = new DOMParser().parseFromString(chunk,'text/xml');	
			var eventid = xmldoc.getElementsByTagName('xsi:eventID').item(0).firstChild.nodeValue;
			sendResponseEvent(eventid);
		}catch(error){
			//TODO: for now, do nothing as it means that some event does not contains the 
			//searched node
		}
		for(var index in credentials){
			var responseobj = credentials[index].appId;
			try{
				responseobj.write(chunk);
			}
			catch(error){}
			}
	}
};

//**************** listen for incoming events ***********************
var opts = {key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem')};

http.createServer(app).listen(app.get('port'), function() {
	console.log('Express server listening on port ' + app.get('port'));
});

/*mainhttps = require('https'); //the https object to connect the client with the proxy
mainhttps.createServer(opts, app).listen(app.get('port'), function(){
	console.log('Express HTTPS server listening on port ' + app.get('port'));
});*/
//**************** start the server by registering a channel in BW ************
requestChannel();