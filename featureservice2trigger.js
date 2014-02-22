#!/usr/bin/env node

var async = require('async');
var terraformer = require('terraformer');
var arcgis = require('terraformer-arcgis-parser');
var request = require('request');
var geotrigger = require('geotrigger-js');
var JSONStream = require('JSONStream');
var Mustache = require('Mustache');
var colors = require('colors');
var argv = require('yargs')
    .usage('Usage: $0 --clientSecret=[clientId] --clientSecret=[clientSecret] --serviceUrl=[serviceUrl] -t [tag] -t otherTag')
    .demand(['clientId', 'clientSecret', 'tag', 'serviceUrl'])
    .alias('t', 'tag')
    .default('buffer', 250)
    .default('direction', 'enter')
    .default('authenticate', false)
    .default('concurrency', 25)
    .describe({
      'clientId': 'client id from an application on developers.arcgis.com',
      'clientSecret': 'client secret from an application on developers.arcgis.com',
      'tag': 'tag to apply to the triggers created in the Geotrigger API',
      'serviceUrl': 'the URL of the Feature Layer you would like to import',
      'buffer': 'if you are importing point features, buffer them by this amount to create the trigger area',
      'trackingProfile':'Changes the devices tracking profile to this at when the trigger is fired',
      'notificationTemplate': 'A Mustache template for the push notification. Feature attributes will be passed into the template context',
      'useFeatureIds': 'use the ids of the feautres as the id of the trigger',
      'callbackUrl': 'when the triggers condition is satisfied a POST request will be sent to this URL',
      'authenticate': 'if your feature service is private setting this to true will use your client id and secret to access it',
      'concurrency': 'how many requests will be made simultainiously when creating triggers'
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

geotriggers.on("authentication:error", function(){
  console.log('Error!'.red.bold + ' Couldn\'t authenticate with ArcGIS Online, check your clientId and clientSecret');
  process.exit(1);
});

var errors = 0;
var successes = 0;
var features = 0;

var q = async.queue(function (task, callback) {
  geotriggers.request('trigger/create', task.params, function(error, response){

    if(error){
      errors++;
      console.log('Error!'.red.bold + ' Could not create trigger from feature with id ' + task.featureId, error);
    }

    if(response){
      successes++;
      console.log('Success!'.green.bold + ' Trigger tagged ' + JSON.stringify(response.tags) + ' with id ' + response.triggerId + ' created from feature with id '+ task.featureId);
    }

    callback(error, response);
  });
}, argv.concurrency);

q.drain = function(){
  console.log((errors+successes + ' features').bold +' '+ (successes + ' successes').green.bold +' '+ (errors + ' errors').red.bold);
};

console.log("Getting metadata for " + argv.serviceUrl);

function getToken(callback){
  request({
    method: "post",
    url: "https://arcgis.com/sharing/oauth2/token",
    form: {
      client_id: argv.clientId,
      client_secret: argv.clientSecret,
      grant_type: "client_credentials"
    },
    json: true
  }, function(err, response, body){
    body = body || {};
    if(err || body.error){
      console.log('Error!'.red.bold + ' Couldn\'t authenticate with ArcGIS Online, check your clientId and clientSecret');
      process.exit(1);
    }
    callback(err, body.access_token);
  });
}

function requestFeatures(lastId, callback){
  var requestOptions = {
    method: "get",
    url: argv.serviceUrl + "/query",
    qs: {
      outFields: "*",
      outSR: 4326, // the Geotrigger Service only uses 4326
      where: "FID > " + lastId,
      f: "json"
    },
    json: true
  };

  if(argv.authenticate){
    getToken(function(err, token){
      requestOptions.qs.token = token;
      request(requestOptions, callback);
    });
  } else {
    request(requestOptions, callback);
  }

}

function createItterator(callback) {
  return function processRequest(err, resp, data){
    var lastId = data.features[data.features.length-1].attributes.FID;
    if(data.exceededTransferLimit){
      requestFeatures(lastId, processRequest);
    }
    for (var i = data.features.length - 1; i >= 0; i--) {
      callback(data.features[i]);
    }
  };
}

function eachFeature(callback){
  requestFeatures(0, createItterator(callback));
}

function startImport(error, response, body) {

  if(error || body.error) {
    console.log('Error!'.red.bold + ' Could not get metadata for ' + argv.serviceUrl +' if your service is private pass the --authenticate flag');
    process.exit(1);
  }

  if(body.geometryType === 'esriGeometryPolyline'){
    console.log('Error!'.red.bold + ' featureservice2geotrigger cannot import Feature Services that contain polylines');
    process.exit(1);
  }

  console.log("Success!".green.bold + " Got metadata for " + argv.serviceUrl);

  var tags;

  if(Array.isArray(argv.tag)){
    tags = argv.tag;
  } else {
    tags = [argv.tag];
  }

  console.log('Requesting Features...');

  function buildParams(feature){
    var geo = {};
    var action = {};
    var triggerParams;

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
      properties: feature.properties
    };

    if(argv.useFeatureIds){
      triggerParams.triggerId = feature.id + "";
    }

    return triggerParams;
  }

  function createTrigger(params, featureId){
    console.time(featureId);

  }

  function processFeature(feature) {
    features++;

    var geojson = arcgis.parse(feature, {
      idAttribute: body.objectIdField
    });

    var params = buildParams(geojson);

    if(geojson.geometry.type === "MultiPolygon"){
      features--; // subtract the multipolygon feature
      var multiPolygon = new terraformer.MultiPolygon(geojson.geometry);
      multiPolygon.forEach(function(coordinates, i){
        params = buildParams(geojson);
        features++; // but we will make a new trigger for each polygon
        params.condition.geo = {
          geojson: {
            type: "Polygon",
            coordinates: coordinates
          }
        };
        if(params.triggerId){
          params.triggerId = params.triggerId + "-" + i;
        }
        q.push({
          params: params,
          featureId: geojson.id
        });
      });
    }

    if(geojson.geometry.type === "Polygon"){
      params.condition.geo = {
        geojson: geojson.geometry
      };
      q.push({
        params: params,
        featureId: geojson.id
      });
    }

    if(geojson.geometry.type === "Point"){
      params.condition.geo = {
        latitude: geojson.geometry.coordinates[1],
        longitude: geojson.geometry.coordinates[0],
        distance: argv.buffer
      };

      q.push({
        params: params,
        featureId: geojson.id
      });
    }
  }

  eachFeature(processFeature);
}

var requestOptions = {
  method: "GET",
  url: argv.serviceUrl,
  json: true,
  qs: {
    f: 'json'
  }
};

if(argv.authenticate){
  getToken(function(err, token){
    requestOptions.qs.token = token;
    request(requestOptions, startImport);
  });
} else {
  request(requestOptions, startImport);
}