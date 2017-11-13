'use strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');
pg.defaults.ssl = true;

module.exports = {

    readAllDegrees: function(callback) {
        var pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT degree_name FROM public.degree_names',
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback([]);
                        } else {
                            let degrees = [];
                            for (let i = 0; i < result.rows.length; i++) {
                                degrees.push(result.rows[i]['degree_name']);
                            }
                            callback(colors);
                        };
                    });
            done();
        });
        pool.end();
    },


    readUserDegree: function(callback, userId) {
        var pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT degree FROM public.user_degree WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                        } else {
                            callback(result.rows[0]['degree']);
                        };
                    });
            done();
        });
        pool.end();
    },

    updateUserDegree: function(degree, userId) {
        var pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }

            let sql1 = `SELECT degree FROM user_degree WHERE fb_id='${userId}' LIMIT 1`;
            client
                .query(sql1,
                    function(err, result) {
                        if (err) {
                            console.log('Query error: ' + err);
                        } else {
                            let sql;
                            if (result.rows.length === 0) {
                                sql = 'INSERT INTO public.user_degree (degree, fb_id) VALUES ($1, $2)';
                            } else {
                                sql = 'UPDATE public.user_degree SET degree=$1 WHERE fb_id=$2';
                            }
                            client.query(sql,
                            [
                                color,
                                userId
                            ]);
                        }
                    }
                    );

            done();
        });
        pool.end();
    }


}
