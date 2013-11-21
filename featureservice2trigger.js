#!/usr/bin/env node

var request = require('request');
var geotrigger = require('geotrigger-js');
var JSONStream = require('JSONStream');
var Mustache = require('Mustache');
var colors = require('colors');
var argv = require('optimist')
    .usage('Usage: $0 -i [clientId] -s [clientSecret] -u [serviceUrl] -t [tags]')
    .demand(['clientId', 'clientSecret', 'tag', 'serviceUrl'])
    .alias('t', 'tag')
    .default('buffer', '250')
    .default('direction', 'enter')
    .describe({
      'clientId': 'client id from an application on developers.arcgis.com',
      'clientSecret': 'client secret from an application on developers.arcgis.com',
      'tag': 'tag to apply to the triggers created in the Geotrigger API',
      'serviceUrl': 'the URL of the Feature Layer you would like to import',
      'buffer': 'if you are importing point features, buffer them by this amount to create the trigger area',
      'trackingProfile':'Changes the devices tracking profile to this at when the trigger is fired',
      'notificationTemplate': 'A Mustache template for the push notification. Feature attributes will be passed into the template context',
      'useFeatureIds': 'use the ids of the feautres as the id of the trigger',
      'callbackUrl': 'when the triggers condition is satisfied a POST request will be sent to this URL'
    })
    .check(function(argv){
      if (!argv.callbackUrl && !argv.notificationTemplate && !argv.trackingProfile) {
        throw 'At least one of --callbackUrl, --notificationTemplate or --trackingProfile is required';
      }
    })
    .check(function(argv){
      if (argv.trackingProfile && !argv.trackingProfile.match(/off|rough|adaptive|fine/)) {
        throw '--trackingProfile must bes off, rough, fine or adaptive';
      }
    })
    .argv;

var geotriggers = new geotrigger.Session({
  clientId: argv.clientId,
  clientSecret: argv.clientSecret
});

console.log("Getting metadata for " + argv.serviceUrl);

request({
  method: "GET",
  url: argv.serviceUrl,
  json: true,
  form: {
    f: 'json'
  }
}, function (error, response, body) {

  if(error || body.error) {
    console.log('Error!'.red.bold + ' Could not get metadata for ' + argv.serviceUrl);
    process.exit(1);
  }

  if(body.geometryType === 'esriGeometryPolyline'){
    console.log('Error!'.red.bold + ' featureservice2geotrigger cannot import Feature Services that contain polylines');
    process.exit(1);
  }

  if(body){
    console.log("Success!".green.bold + " Got metadata for " + argv.serviceUrl);
    console.log("");

    var errors = 0;
    var successes = 0;
    var features = 0;
    var processed = 0;
    var featureIdAttribute = body.objectIdField;
    var featureParser = JSONStream.parse(['features', true]);
    var tags;

    if(Array.isArray(argv.tag)){
      tags = argv.tag;
    } else {
      tags = [argv.tag];
    }

    console.log('Requesting Features...');

    request({
      method: 'GET',
      url: argv.serviceUrl + '/query',
      form: {
        where: '1=1', // 'truthy' query to get all features
        outSR: 4326, // the Geotrigger Service only uses 4326
        outFields: '*', // get all fields as output
        f: 'json' // we want JSON back
      },
      json: true
    }).pipe(featureParser); // send the results of this request to our JSON parser

    featureParser.on('data', function (feature) {
      features++;

      var geo = {};
      var action = {};
      var featureId = feature.attributes[featureIdAttribute] + "";
      var triggerParams;

      if(feature.geometry.rings){
        geo = {
          esrijson: feature.geometry
        };
      }

      if(feature.geometry.x && feature.geometry.y){
        geo = {
          latitude: feature.geometry.y,
          longitude: feature.geometry.x,
          distance: argv.buffer
        };
      }

      if(argv.callbackUrl) {
        action.callbackUrl = argv.callbackUrl;
      }

      if(argv.notificationTemplate) {
        action.notification = {
          text: Mustache.render(argv.notificationTemplate, feature.attributes)
        };
      }

      if(argv.trackingProfile) {
        action.trackingProfile = argv.trackingProfile;
      }

      triggerParams = {
        condition: {
          direction: argv.direction,
          geo: geo
        },
        action: action,
        setTags: tags,
        properties: feature.attributes
      };

      if(argv.useFeatureIds){
        triggerParams.triggerId = featureId;
      }

      geotriggers.request('trigger/create', triggerParams, function(error, response){
        processed++;

        if(error){
          errors++;
          console.log('Error!'.red.bold + ' Could not create trigger from feature with id ' + featureId, error);
        }

        if(response){
          successes++;
          console.log('Success!'.green.bold + ' Trigger tagged ' + JSON.stringify(response.tags) + ' with id ' + response.triggerId + ' created from feature with id '+ featureId);
        }

        if(processed >= features){
          console.log((errors+successes + ' features').bold +' '+ (successes + ' successes').green.bold +' '+ (errors + ' errors').red.bold);
        }
      });
    });
  }
});