'user strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');

pg.defaults.ssl = true;

module.exports = function(callback, userId){
    console.log("ENTERED COURSES.JS");
    request({
	 uri: 'https://graph.facebook.com/v2.7/' + userId,
	 qs: {
		access_token: config.FB_PAGE_TOKEN
	     }

	    }, function (error, response, body) {
	       if (!error && response.statusCode == 200) {

		var user = JSON.parse(body);

		if (user.first_name) {

                console.log("iNSIDE COURSES");
		var pool = new pg.Pool(config.PG_CONFIG);
	        pool.connect(function(err, client, done) {
			
	        if (err) 
		{
		   return console.error('Error acquiring client', err.stack);
		}
			
		var rows = [];
		console.log('fetching courses');
	        client.query(`SELECT courses FROM compsci_courses`,
		function(err, result) 
	        {
		    console.log('query result ' + result);
		    if (err) 
		    {
			console.log('Query error: ' + err);
		    } 
		    else 
		    {
			console.log('rows: ' + result.rows.length);
			if (result.rows.length != 0) {
		        let sql = 'SELECT courses FROM compsci_courses';
		        console.log('sql: ' + sql);
			const query = client.query(sql);
		     }
                     console.log("SUCCESSFULLY PASSED QUERY")
		}
                console.log(user);
                callback(query);
		});
		});
		pool.end();

		} else 
		{
		   console.log("Cannot get data for fb user with id", userId);
		}
	    } else 
	    {
		console.error(response.error);
	    }
	});
}
