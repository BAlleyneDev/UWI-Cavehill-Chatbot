'user strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');

pg.defaults.ssl = true;

module.exports = function(callback, userId){
    console.log("ENTERED USER.JS");
    request({
		uri: 'https://graph.facebook.com/v2.7/' + userId,
		qs: {
			access_token: config.FB_PAGE_TOKEN
		}

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {

			var user = JSON.parse(body);
            console.log('USERObject'+user.email);
			if (user.first_name) {

                    console.log("USER FIRST NAME OBTAINED");
					var pool = new pg.Pool(config.PG_CONFIG);
					pool.connect(function(err, client, done) {
						if (err) {
							return console.error('Error acquiring client', err.stack);
						}
						var rows = [];
						console.log('fetching user');
						client.query(`SELECT id FROM users WHERE fb_id='${userId}' LIMIT 1`,
							function(err, result) {
								console.log('query result ' + result);
								if (err) {
									console.log('Query error: ' + err);
								} else {
									console.log('rows: ' + result.rows.length);
									if (result.rows.length === 0) {
										let sql = 'INSERT INTO users (fb_id, first_name, last_name, profile_pic, ' +
											'locale, timezone, gender, email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
										console.log('sql: ' + sql);
										client.query(sql,
											[
												userId,
												user.first_name,
												user.last_name,
												user.profile_pic,
												user.locale,
												user.timezone,
												user.gender,
												user.email
											]);
									}
									console.log(user.email);
                                    console.log("SUCCESSFULLY PASSED QUERY")
								}
                                console.log(user);
                                callback(user);
							});

					});
					pool.end();

			} else {
				console.log("Cannot get data for fb user with id",
					userId);
			}
		} else {
			console.error(response.error);
		}
	});
}