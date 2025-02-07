'use strict';

const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const pg = require('pg');
const app = express();
const uuid = require('uuid');
const userData = require('./user');
/*const degrees = require('./degrees');
const courses = require('./courses');
*/

pg.defaults.ssl = true;

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}
if (!config.PG_CONFIG) { //postgresql config obj
	throw new Error('missing PG_CONFIG');
}



app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())




const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "en",
	requestSource: "fb"
});
const sessionIds = new Map();
const usersMap = new Map();

// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));



	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});



function setSessionAndUser(senderID){
   if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}
console.log('ENTERING USER MAP SET');
	if(!usersMap.has(senderID)){
		console.log('ENTERed USER MAP SET');
		userData(user=>{
		  console.log('SENDER '+senderID + '1USER = ' + user);
          usersMap.set(senderID, user);
		},senderID);

		/*userData(function(user){
			//usersMap.set(senderID, user);
			console.log('SENDER '+senderID + '2USER = ' + user);
			usersMap.set(senderID, user);
			console.log('SET USER MAP '+ user);
		},senderID);
		*/
	}
}


function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	setSessionAndUser(senderID);
	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		sendToApiAi(senderID, messageText);
	} else if (messageAttachments) {
		handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleMessageAttachments(messageAttachments, senderID){
	//for now just reply
	sendTextMessage(senderID, "Attachment received. Thank you.");	
}

function handleQuickReply(senderID, quickReply, messageId) {
	var quickReplyPayload = quickReply.payload;
	console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
	//send payload to api.ai
	sendToApiAi(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
	// Just logging message echoes to console
	console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}
 
function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	console.log("Checking action");
	
	switch (action) {
		/*case "getBuildingLocation":
		   console.log("OUT");
		   if (parameters.hasOwnProperty("campus-places") && parameters["campus-places"] != "")
		   {
			   console.log("IN");
			     var request = require('request');
							request({
						uri: 'https://maps.googleapis.com/maps/api/js?key='+'AIzaSyCLoCC07tWYjgQgrXXptv76p0wazqA8ZzQ'+'&callback=initMap',
						qs: {
							appid:"AIzaSyCLoCC07tWYjgQgrXXptv76p0wazqA8ZzQ",
							q: parameters["campus-places"]
						}

					}, function (error, response, body) {
						if (!error && response.statusCode == 200) {
							var google;

							var uluru = {lat: -25.363, lng: 131.044};
                            var map = new google.maps.Map(document.getElementById('map'), {
                            zoom: 4,
                            center: uluru
                             });
                            var marker = new google.maps.Marker({
                            position: uluru,
                           map: map
                          });

						  sendImageMessage(sender,map);
						} else {
							console.error(response.error);
						}

					});
		   }
		   else
		   {
			   sendTextMessage(sender, responseText);
		   }
		break;

*/

        case "closing-time":
		     console.log('In CLOSING');
             if(!isDefined(contexts[0] && contexts[0].parameters))
		     {
				 let building = (isDefined(parameters['campus-places'])
				 && parameters['campus-places']!='') ? parameters['campus-places']:'';
				 
				 if (building =="CHADM1")
				     building = 'Admin'; 

				 let pool = new pg.Pool(config.PG_CONFIG);
			  pool.connect(function(err, client, done){
				  if (err){
					  return console.error('Error acquiring client');
				  }
				  var rows = [];
				  var query = client.query(`SELECT opening_hour,weekend_open,friday FROM building_opening_hours WHERE building_name='${building}'`,
				  function(err, result) {
					    var value = JSON.stringify(result.rows);
						let hours = [];
						let hoursPrint;
						
						for (let i=0; i<result.rows.length; i++)
						{
						   hours.push('Weekdays:\n');
						   hoursPrint = hours.join("");
                           hours.push(result.rows[i]['opening_hour']);
						   hoursPrint = hours.join("");
						   hours.push('\n Weekends:\n');
						   hoursPrint = hours.join("");
						   hours.push(result.rows[i]['weekend_open']);
						   hoursPrint = hours.join("");
						   hours.push('\n Friday(if applicable):\n');
						   hoursPrint = hours.join("");
						   hours.push(result.rows[i]['friday']);
						   hoursPrint = hours.join("");
						   hours.push('\n');

						   console.log('RESULT ROWS = '+ JSON.stringify(result.rows[i]));
						}
						
                       console.log('Array 1: '+hours);
					   
						
                        console.log('ARRAY VAL='+value[3]);
                        let reply = `${building} opening times are: \n ${hoursPrint}`;
					  sendTextMessage(sender, reply);
					  console.log('reply:'+reply);
				  }
				  );


				//  	query.on("row", function(row,result){
                    
			//  });
			  })
			  pool.end();
		     }
			 else
			 {
		      sendTextMessage(sender,responseText);
	         }
		break;
   
		case "getQuote":

		let country = (isDefined(parameters['countries']) 
		&& parameters['countries']!='') ? parameters['countries']:'';

		let number = (isDefined(parameters['number']) 
		&& parameters['number']!='') ? parameters['number']:'';

		let output;
		if (country == "Canada")
	   {
		  output = amount*1.10;
	   }
	   else
	   {
		 output = amount*1.25;
	   }

       let reply ="The cost to send"+amount+"USD is"+output;

	   sendTextMessage(sender, reply);
		break;


		case "lecturer-courses":
		console.log("SENDERiD:"+sender);
		   if(!isDefined(contexts[0] && contexts[0].parameters))
		   {
               let name = (isDefined(parameters['lecturer']) 
			  && parameters['lecturer']!='') ? parameters['lecturer']:'';
               

			  let pool = new pg.Pool(config.PG_CONFIG);
			  pool.connect(function(err, client, done){
				  if (err){
					  return console.error('Error acquiring client');
				  }
				  var rows = [];
				  var query = client.query(`SELECT courses FROM lecturers WHERE name='${name}'`,
				  function(err, result) {
					    var value = JSON.stringify(result.rows);
						let courses = [];
						let coursesPrint;
						
						for (let i=0; i<result.rows.length; i++)
						{
                           courses.push(result.rows[i]['courses']);
						   coursesPrint = courses.join(",");
						   courses.push('\n');
						}
						
                       console.log('Array 1: '+coursesPrint);
					   
						
                        let reply = `${name} teaches ${coursesPrint}.`;
					  sendTextMessage(sender, reply);
					  console.log('reply:'+reply);
				  }
				  );

				//  	query.on("row", function(row,result){
				    
                    
			//  });
			  })
			  pool.end();
		   }
		   else
		   {
			   sendTextMessage(sender,responseText);
		   }
		break;

		case "course_lect_sem":
		   if(!isDefined(contexts[0] && contexts[0].parameters))
		   {
			  let courseName = (isDefined(parameters['course-names']) 
			  && parameters['course-names']!='') ? parameters['course-names']:'';
			  
			  let semester = (isDefined(parameters['school-period']) 
			  && parameters['school-period']!='') ? parameters['school-period']:'';
			  
			  console.log('COURSENAME'+courseName);
			  console.log('SEMESTER:'+semester);

			  let pool = new pg.Pool(config.PG_CONFIG);
			  pool.connect(function(err, client, done){
				  if (err){
					  return console.error('Error acquiring client');
				  }
				  var rows = [];
				  var query = client.query(`SELECT lectsemone,lectsemtwo FROM compsci_courses WHERE course LIKE '${courseName}%'`,
				  function(err, result) {
						var value = JSON.stringify(result.rows);
						console.log("VALUE:"+value);
						console.log("LECTSEMTWO:"+result.rows[0].lectsemtwo);
						let lecSemester;
						if (isDefined(result.rows[0].lectsemone) || isDefined(result.rows[0].lectsemtwo))
						{
							console.log('SEM1IF');
							console.log('SEMESTER:'+semester);
							if(semester == 1 && isDefined(result.rows[0].lectsemone))
							{
							  lecSemester=result.rows[0].lectsemone;
							}
							else if(semester == 2 && isDefined(result.rows[0].lectsemtwo))
							{
							  lecSemester=result.rows[0].lectsemtwo;
							}
							else
							  lecSemester = "No lecturer has been assigned to this course.";
						}
						else
							  lecSemester= "No lecturer has been assigned to this course.";
						
						
						
						
						
                       console.log('Array 1: '+lecSemester);
					   let reply;
						if (lecSemester == "No lecturer has been assigned to this course.")
						    reply = `Sorry. ${lecSemester}`;
						else
						{
							if(courseName == "COMP3910" || courseName == "COMP3920" || courseName == "COMP3930")
							{
                               reply = lecSemester;
							}
							else
							reply = `${lecSemester} teaches ${courseName} in semester ${semester}.`;
						}
					  sendTextMessage(sender, reply);
					  console.log('reply:'+reply);
				  }
				  );


				//  	query.on("row", function(row,result){
				    
                    
			//  });
			  })
			  pool.end();
		   }
		   else
		   {
			   sendTextMessage(sender,responseText);
		   }
		break;

		case "course-rating":
			if(!isDefined(contexts[0] && contexts[0].parameters))
			{
				let courseName = (isDefined(parameters['course-names']) 
			  && parameters['course-names']!='') ? parameters['course-names']:'';

			  let pool = new pg.Pool(config.PG_CONFIG);
			  pool.connect(function(err, client, done){
				  if (err){
					  return console.error('Error acquiring client');
				  }
				  var rows = [];
				  var query = client.query(`SELECT rating FROM compsci_courses WHERE course LIKE '${courseName}%'`,
				  function(err, result) {
						var value = JSON.stringify(result.rows);
						console.log("VALUE:"+value);
						console.log("RATING:"+result.rows[0].rating);
						let rating="Test";
						
						if(isDefined(result.rows[0].rating))
						{		
							  rating=result.rows[0].rating;
						}
						else{
							rating = "There has been no rating assigned to this course.";
						}
						
						
						
						
                       console.log('Array 1: '+rating);
					   let reply;
						if (rating == "There has been no rating assigned to this course.")
						    reply = `Sorry. ${rating}`;
						else
                            reply = `${courseName} has received a rating of ${rating} from a survey of students.(1-easy & 5-hard)`;
					  sendTextMessage(sender, reply);
					  console.log('reply:'+reply);
				  }
				  );
			  })
			  pool.end();
			}
			else
			{
				sendTextMessage(sender,responseText);
			}
		break;

		case "locate_building":
		   if(!isDefined(contexts[0] && contexts[0].parameters))
		   {
			let building = (isDefined(parameters['buildingsANDrooms']) 
			&& parameters['buildingsANDrooms']!='') ? parameters['buildingsANDrooms']:'';

			let reply;

			if (building == "CHADM1")
			{
               reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHADM1/CHADM1_Frames.htm";
			}
			else if (building == "CHADM2")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHADM2/CHADM2_Frames.htm";
			}
			else if (building == "CHCAC")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHCAC/CHCAC_Frames.htm";
			}
			else if (building == "CHCC01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHCC01/CHCC01_Frames.htm";
			}
			else if (building == "CHCTEX")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHCTEX/CHCTEX_Frames.htm";
			}
			else if (building == "CHDE01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHDE01/CHDE01_Frames.htm";
			}
			else if (building == "CHHE01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHHE01/CHHE01_Frames.htm";
			}
			else if (building == "CHHE02")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHHE02/CHHE02_Frames.htm";
			}
			else if (building == "CHHE03")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHHE03/CHHE03_Frames.htm";
			}
			else if (building == "CHLW01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHLW01/CHLW01_Frames.htm";
			}
			else if (building == "CHNTC")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHNTC/CHNTC_Frames.htm";
			}
			else if (building == "CHOPEN")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHOPEN/CHOPEN_Frames.htm";
			}
			else if (building == "CHPA01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHPA01/CHPA01_Frames.htm";
			}
			else if (building == "CHPA02")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHPA02/CHPA02_Frames.htm";
			}
			else if (building == "CHPA03")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHPA03/CHPA03_Frames.htm";
			}
			else if (building == "CHPA04")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHPA04/CHPA04_Frames.htm";
			}
			else if (building == "CHPA05")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHPA05/CHPA05_Frames.htm";
			}
			else if (building == "CHPA06")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHPA06/CHPA06_Frames.htm";
			}
			else if (building == "CHPG01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHPG01/CHPG01_Frames.htm";
			}
			else if (building == "CHSS01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHSS01/CHSS01_Frames.htm";
			}
			else if (building == "CHSS02")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHSS02/CHSS02_Frames.htm";
			}
			else if (building == "CHTC01")
			{
			   reply = "https://www.cavehill.uwi.edu/virtualtours/Buildings/CHTC01/CHTC01_Frames.htm";
			}

			let catReply=`That is located in building ${building}. Check out ${reply} for its location.`;
			sendTextMessage(sender, catReply);
		   }
		   else
			{
				sendTextMessage(sender,responseText);
			}
		break;
 
        case "required_courses":
           if(!isDefined(contexts[0] && contexts[0].parameters))
		   {
               let type = (isDefined(parameters['type']) 
			  && parameters['type']!='') ? parameters['type']:'';

			  let degName = (isDefined(parameters['degree-names']) 
			  && parameters['degree-names']!='') ? parameters['degree-names']:'';

              let NB="\n *(English for Academic Purposes OR Rhetoric) AND Caribbean Civilization AND Law & Gov*";
			  if(type == "double")
			  {
               NB="\n*One of the 3 research projects must be done* \n *(English for Academic Purposes OR Rhetoric) AND Caribbean Civilization AND Law & Gov*"
			  }

              
			  let pool = new pg.Pool(config.PG_CONFIG);
			  pool.connect(function(err,client, done){
				  if (err){
					  return console.error('Error acquiring client');
				  }
				  var rows = [];
				  var query = client.query(`SELECT course FROM compsci_courses WHERE ${type}='required'`,
				  function(err, result) {
					    var value = JSON.stringify(result.rows);
						let courses = [];
						let coursesPrint;
						
						console.log(`Result array: ${value}`);
						for (let i=0; i<result.rows.length; i++)
						{
                           courses.push(result.rows[i].course);
						   coursesPrint = courses.join("");
						   courses.push('\n');
						}
						courses.push('\n');
						
                       console.log('Array 1: '+courses);
					   
						
                        console.log('ARRAY VAL='+value[3]);
                        let reply = `The courses you are required to take for computer science(${type}) are \n${coursesPrint}.${NB}`;
					  sendTextMessage(sender, reply);
					  console.log('reply:'+reply);
				  }
				  );
				  
			  })
			  pool.end();
		   }
		   else
		   {
			   sendTextMessage(sender,responseText);
		   }
		break;

        case "deg-courses":
		//  courses.readAllCourses(function(alldegrees){
			//  console.log("Degrees:"+alldegrees);
			if(!isDefined(contexts[0] && contexts[0].parameters))
		{
			console.log("DEFINED PARAMETERS :"+contexts[0]);
            let sem = (isDefined(parameters['school-period']) 
			  && parameters['school-period']!='') ? parameters['school-period']:'';

			let yr = (isDefined(parameters['school-year']) 
			  && parameters['school-year']!='') ? parameters['school-year']:'';

			  let semb='';

			  console.log(sem);
			  console.log(yr);
			  if((sem == '1'|| sem=='2') && yr=='1')
			  {
				  sem='1&2';
				  semb="1&2";
			  }
			  else if(sem =='1' && yr=='2')
			  {
				  sem="1&2";
				  semb="1";
			  }
			  else if(sem =='2' && yr=='2')
			  {
				  sem="1&2";
				  semb="2";
			  }
			  else if(sem =='1' && yr=='3')
			  {
				  sem="1&2";
				  semb="1"
			  }
			   else if(sem =='2' && yr=='3')
			  {
				  sem="1&2";
				  semb="2"
			  }

			  let pool = new pg.Pool(config.PG_CONFIG);
			  pool.connect(function(err, client, done){
				  if (err){
					  return console.error('Error acquiring client');
				  }
				  var rows = [];
				  var query = client.query(`SELECT course FROM compsci_courses WHERE year='${yr}' AND semester IN('${sem}','${semb}')`,
				  function(err, result) {
					    var value = JSON.stringify(result.rows);
						let courses = [];
						let coursesPrint;
						
						for (let i=0; i<result.rows.length; i++)
						{
                           courses.push(result.rows[i]['course']);
						   coursesPrint = courses.join("");
						   courses.push('\n');
						}
						courses.push('\n');
						
                       console.log('Array 1: '+courses);
					   
						
                        console.log('ARRAY VAL='+value[3]);
                        let reply = `The courses available for computer science are \n${coursesPrint}.`;
					  sendTextMessage(sender, reply);
					  console.log('reply:'+reply);
				  }
				  );


				//  	query.on("row", function(row,result){
				
			//  });
			  })
			  pool.end();
	} else{
		sendTextMessage(sender,responseText);
	}
			  //let allcoursesString = alldegrees.join(', ');

			  
            
			
		//  });
		break;

		case "faq-ques":
		if(isDefined(contexts[0]) && contexts[0].name == 'answer-req' && contexts[0].parameters)
		{
			
              let question = (isDefined(contexts[0].parameters['question-words']) 
			  && contexts[0].parameters['question-words']!='') ? contexts[0].parameters['question-words']:'';
              
			  let questionbody = (isDefined(contexts[0].parameters['question-body'])
			  && contexts[0].parameters['question-body']!='') ? contexts[0].parameters['question-body']:'';

			  let email = (isDefined(contexts[0].parameters['email'])
			  && contexts[0].parameters['email']!='') ? contexts[0].parameters['email']:'';


			  if(question != '')
			  {
				  console.log('Pass to question if');
				  let emailContent = 'The user '+email+' sent in the question:\n'+question + " " + questionbody;
				  sendEmail('New question',emailContent, email);
			  } 
		}
		sendTextMessage(sender,responseText);
		break;

		case "degree-enquiry":
		let replies =[
			{
			"content_type":"text",
			"title":"Single Major",
			"payload":"Single Major"
		   },
		   {
			"content_type":"text",
			"title":"Double Major",
			"payload":"Double Major" 
		   },
		   {
			"content_type":"text",
			"title":"Major with Minor",
			"payload":"Major with Minor" 
		   }
		   ,
		   {
			"content_type":"text",
			"title":"Not interested",
			"payload":"Not interested" 
		   }
		];
		sendQuickReply(sender,responseText,replies);
		break;
		default:
			//unhandled action, just send back the text
			sendTextMessage(sender, responseText);
	}
}

function handleMessage(message, sender) {
	switch (message.type) {
		case 0: //text
			sendTextMessage(sender, message.speech);
			break;
		case 2: //quick replies
			let replies = [];
			for (var b = 0; b < message.replies.length; b++) {
				let reply =
				{
					"content_type": "text",
					"title": message.replies[b],
					"payload": message.replies[b]
				}
				replies.push(reply);
			}
			sendQuickReply(sender, message.title, replies);
			break;
		case 3: //image
			sendImageMessage(sender, message.imageUrl);
			break;
		case 4:
			// custom payload
			var messageData = {
				recipient: {
					id: sender
				},
				message: message.payload.facebook

			};

			callSendAPI(messageData);

			break;
	}
}


function handleCardMessages(messages, sender) {

	let elements = [];
	for (var m = 0; m < messages.length; m++) {
		let message = messages[m];
		let buttons = [];
		for (var b = 0; b < message.buttons.length; b++) {
			let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
			let button;
			if (isLink) {
				button = {
					"type": "web_url",
					"title": message.buttons[b].text,
					"url": message.buttons[b].postback
				}
			} else {
				button = {
					"type": "postback",
					"title": message.buttons[b].text,
					"payload": message.buttons[b].postback
				}
			}
			buttons.push(button);
		}


		let element = {
			"title": message.title,
			"image_url":message.imageUrl,
			"subtitle": message.subtitle,
			"buttons": buttons
		};
		elements.push(element);
	}
	sendGenericMessage(sender, elements);
}


function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	sendTypingOff(sender);

	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
		let timeoutInterval = 1100;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;
		for (var i = 0; i < messages.length; i++) {

			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

				timeout = (i - 1) * timeoutInterval;
				setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
				cardTypes = [];
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			} else if ( messages[i].type == 1 && i == messages.length - 1) {
				cardTypes.push(messages[i]);
                		timeout = (i - 1) * timeoutInterval;
                		setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                		cardTypes = [];
			} else if ( messages[i].type == 1 ) {
				cardTypes.push(messages[i]);
			} else {
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}
	} else if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		console.log('Unknown query' + response.result.resolvedQuery);
		sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (isDefined(action)) {
		handleApiAiAction(sender, action, responseText, contexts, parameters);
	} else if (isDefined(responseData) && isDefined(responseData.facebook)) {
		try {
			console.log('Response as formatted message' + responseData.facebook);
			sendTextMessage(sender, responseData.facebook);
		} catch (err) {
			sendTextMessage(sender, err.message);
		}
	} else if (isDefined(responseText)) {

		sendTextMessage(sender, responseText);
	}
}

function sendToApiAi(sender, text) {

	sendTypingOn(sender);
	let apiaiRequest = apiAiService.textRequest(text, {
		sessionId: sessionIds.get(sender)
	});

	apiaiRequest.on('response', (response) => {
		if (isDefined(response.result)) {
			handleApiAiResponse(sender, response);
		}
	});

	apiaiRequest.on('error', (error) => console.error(error));
	apiaiRequest.end();
}




function sendTextMessage(recipientId, text) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text
		}
	}
	callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: imageUrl
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: config.SERVER_URL + "/assets/instagram_logo.gif"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "audio",
				payload: {
					url: config.SERVER_URL + "/assets/sample.mp3"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "video",
				payload: {
					url: config.SERVER_URL + videoName
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "file",
				payload: {
					url: config.SERVER_URL + fileName
				}
			}
		}
	};

	callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: text,
					buttons: buttons
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: elements
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
							timestamp, elements, address, summary, adjustments) {
	// Generate a random receipt ID as the API requires a unique ID
	var receiptId = "order" + Math.floor(Math.random() * 1000);

	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "receipt",
					recipient_name: recipient_name,
					order_number: receiptId,
					currency: currency,
					payment_method: payment_method,
					timestamp: timestamp,
					elements: elements,
					address: address,
					summary: summary,
					adjustments: adjustments
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text,
			metadata: isDefined(metadata)?metadata:'',
			quick_replies: replies
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "Welcome. Link your account.",
					buttons: [{
						type: "account_link",
						url: config.SERVER_URL + "/authorize"
          }]
				}
			}
		}
	};

	callSendAPI(messageData);
}


function greetUserText(userId) {
    console.log("USERID:"+userId);
	setSessionAndUser(userId);
	let user = usersMap.get(userId);

    console.log("USER MAP INFO "+user);
	if(user == undefined)
	{
		setSessionAndUser(userId);
	}
    sendTextMessage(userId, "Hello " + user.first_name + ' :). Welcome to the UWI Cavehill Bot. I can answer questions such as:\n What time does CMP Building close?\n How do I log into elearning?\n' 
				+' What can I help you with?');
	}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

	setSessionAndUser(senderID);

	// The 'payload' param is a developer-defined field which is set in a postback 
	// button for Structured Messages. 
	var payload = event.postback.payload;

	switch (payload) {
	    case 'DEG_COURSES':
		    sendToApiAi(senderID, "courses for");
		break;

		case 'TIPS':
		    sendToApiAi(senderID, "tips");
		break;

		case 'GET_STARTED':
		    console.log("INSIDE OF GET STARTED");
			console.log("SENDERid = "+senderID);
		    greetUserText(senderID);
		break;
		default:
			//unindentified payload
			sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var status = event.account_linking.status;
	var authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s " +
		"and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function (messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the 
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger' 
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function sendEmail(subject, content, email){

	
    console.log('USER EMAIL:'+email);
	console.log('Reached the mail function');
       const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(<APIKEY>);
const msg = {
  to: config.EMAIL_TO,
  cc: email,
  from: config.EMAIL_FROM,
  subject: subject,
  text: content,
};
sgMail.send(msg); 
}

function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
