#!/usr/bin/env node

// request is a generic HTTP library for Node.js
var request = require("request");

// geotrigger-js is a Node.js library for interacting with the Geotrigger Service
var geotrigger = require("geotrigger-js");

// JSONStream turns JSON objects into Node.js streams
var JSONStream = require("JSONStream");

// Mustache templating library for handling push notification templating
var Mustache = require("Mustache");

// coloring for console output
var colors = require('colors');

// optimist helps manage command line options
var argv = require('optimist')
  // declare the basic usage of this script
  .usage('Usage: $0 -i [clientId] -s [clientSecret] -u [serviceUrl] -t [tags]')

  // setup the clientId option
  .alias('i', 'clientId')
  .demand('clientId')
  .describe('clientId', "client id from an application on developers.arcgis.com")

  // setup the clientSecret option
  .alias('s', 'clientSecret')
  .demand('clientSecret')
  .describe('clientSecret', "client secret from an application on developers.arcgis.com")

  // setup the serviceUrl option
  .alias('u', 'serviceUrl')
  .demand('serviceUrl')
  .describe('serviceUrl', "the URL of the Feature Layer you would like to import")

  // setup the tags option
  .alias('t', 'tag')
  .describe('tag', "tag to apply to the triggers created in the Geotrigger API")
  .demand('tag')

  // setup the buffer option for point features
  .alias('b', 'buffer')
  .default('b', 250)
  .describe('b', "if you are importing point features, buffer them by this amount to create the trigger area")

  // setup the direction options
  .options('d', {
    alias: 'direction',
    default: 'enter'
  })

  // setup the callbackUrl option
  .describe('useFeatureIds', "use the ids of the feautres as the id of the trigger")

  // setup the callbackUrl option
  .describe('callbackUrl', "when the triggers condition is satisfied a POST request will be sent to this URL")

  // setup the notificationTemplate option
  .describe('notificationTemplate', "A Mustache template for the push notification. Feature attributes will be passed into the template context")

  // setup the trackingProfile option
  .describe('trackingProfile', "Changes the devices tracking profile to this at the ")

  // check to make sure we have everything we need
  .check(function(argv){
    if (!argv.callbackUrl && !argv.notificationTemplate && !argv.trackingProfile) {
      throw 'At least one of --callbackUrl, --notificationTemplate or --trackingProfile is required';
    }
  })

  // check that the tracking profile is valid
  .check(function(argv){
    if (argv.trackingProfile && (argv.trackingProfile !== "off" || argv.trackingProfile !== "rough" || argv.trackingProfile !== "adaptive" || argv.trackingProfile !== "fine")) {
      throw '--trackingProfile must be one of "off", "rough", "fine" or "adaptive"';
    }
  })

  // and wrap up
  .argv;

// print a new line
console.log("");

// create a new Geotrigger Session to make API requests to the Geotrigger Service
var geotriggers = new geotrigger.Session({
  clientId: argv.clientId,
  clientSecret: argv.clientSecret
});

var tags;

if(Array.isArray(argv.tag)){
  tags = argv.tag;
} else {
  tags = [argv.tag];
}

// make a request to get some metadata about the service
console.log("Getting metadata for " + argv.serviceUrl);
request({
  method: "GET",
  url: argv.serviceUrl,
  form: {
    f: 'json'
  },
  json: true
}, function (error, response, body) {
  //if anything went wrong print an error message and exit
  if(error || body.error) {
    console.log("Error!".red.bold + " Could not get metadata for " + argv.serviceUrl);
    process.exit(1);
  }

  // print an error and exit if this service uses polylines
  if(body.geometryType === "esriGeometryPolyline"){
    console.log("Error!".red.bold + " featureservice2geotrigger cannot import Feature Services that contain polylines");
    process.exit(1);
  }

  // check to make sure the service contains points or polygons
  if(body){
    console.log("Success!".green.bold + " Got metadata for " + argv.serviceUrl);
    console.log("");

    // setup some basic counters for things
    var errors = 0;
    var successes = 0;
    var features = 0;
    var processed = 0;

    // get the name of the id field
    var featureIdAttribute = body.objectIdField;

    // get a new JSONStream that will parse an array of features into a stream
    var featureParser = JSONStream.parse(['features', true]);

    console.log("Requesting Features...");

    // make a query request to get all the features from our service
    request({
      method: "GET",
      url: argv.serviceUrl + "/query",
      form: {
        where: "1=1", // "truthy" query to get all features
        outSR: 4326, // the Geotrigger Service only uses 4326
        outFields: "*", // get all fields as output
        f: "json" // we want JSON back
      },
      json: true
    }).pipe(featureParser); // send the results of this request to our JSON parser

    // when we see a new feature from the parser build the trigger create parameters and send the request to the Geotrigger Service
    featureParser.on("data", function (feature) {
      // incriment the number of features we have seen
      features++;

      // create some variables to hold our geographic condition and our action
      var geo = {};
      var action = {};

      // add the geo condition
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

      // create the actions to be taken when this trigger fires
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

      // get the features id
      var featureId = feature.attributes[featureIdAttribute] + "";

      // build our triggers parameters
      var triggerParams = {
        condition: {
          direction: argv.direction,
          geo: geo
        },
        action: action,
        setTags: tags,
        properties: feature.attributes
      };

      // if we want to use the features id as the triggers id set that up
      if(argv.useFeatureIds){
        triggerParams.triggerId = featureId;
      }

      // create the trigger
      geotriggers.request("trigger/create", triggerParams, function(error, response){
        // incriment the number of triggers processed
        processed++;

        // if there was an error creating the trigger incriment errors and log
        if(error){
          errors++;
          console.log("Error!".red.bold + " Could not create trigger from feature with id"+ featureId, error);
        }

        // if we were successful incriment success and log
        if(response){
          successes++;
          console.log("Success!".green.bold + " Trigger tagged " + JSON.stringify(response.tags) + " with id " + response.triggerId + " created from feature with id "+ featureId);
        }

        // we have seem and processed the same #of features we are done
        if(processed >= features){
          console.log((errors+successes + " features").bold +" "+ (successes + " successes").green.bold +" "+ (errors + " errors").red.bold);
        }
      });
    });
  }
});