# featureservice2triggers

A command line tool for creating Geotrigger Rules from an ArcGIS FeatureService.

## Installation

Just install with NPM. You will need Node.js installed.

```
$ npm install -g featureservice2triggers
```

## Usage

To print the full usage infromation just do...

```
$ featureservice2triggers
```

Here is an example of using `featureservice2triggers` to import a Feature Service of city parks.

```
$ featureservice2triggers --clientId=YOUR_CLIENT_ID --clientSecret=YOUR_CLIENT_SECRET --tag=parks --tag=portland --serviceUrl="http://services.arcgis.com/rOo16HdIMeOBI4Mb/arcgis/rest/services/Parks_pdx/FeatureServer/0" --notificationTemplate="Welcome to {{NAME}}"
```

**Note**

## Resources

* [ArcGIS for Developers](https://developers.arcgis.com)
* [ArcGIS Geotrigger Service](https://developers.arcgis.com/en/geotrigger-service/)
* [@esripdx](http://twitter.com/esri)

## Issues

Find a bug or want to request a new feature?  Please let us know by submitting an issue.

## Contributing

Esri welcomes contributions from anyone and everyone. Please see our [guidelines for contributing](https://github.com/esri/contributing).

## Licensing
Copyright 2013 Esri

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

A copy of the license is available in the repository's [license.txt]( https://raw.github.com/Esri/esri-leaflet/master/license.txt) file.

[](Esri Tags: ArcGIS Geotrigger Service Tools Import FeatureLayer FeatureServer)
[](Esri Language: JavaScript)