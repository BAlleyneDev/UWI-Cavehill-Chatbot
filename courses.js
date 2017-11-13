'use strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');
pg.defaults.ssl = true;

module.exports = {

    readAllCourses: function(callback) {
        var pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT course FROM public.compsci_courses',
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback([]);
                        } else {
                            let courses = [];
                            for (let i = 0; i < result.rows.length; i++) {
                                courses.push(result.rows[i]['course']);
                            }
                            callback(courses);
                        };
                    });
            done();
        });
        pool.end();
    }


}
