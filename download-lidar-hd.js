import fs from 'fs';
import fetch from 'node-fetch';
import proj4 from 'proj4';
import {JSDOM} from 'jsdom';
import { RateLimit } from "async-sema";

const limit = RateLimit(5);

const REGEX_X_Y = new RegExp('([0-9]{4})_([0-9]{4})');
const DATA_TYPE = "lidarhd";
const proj4_2154 = "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

proj4.defs("EPSG:2154", proj4_2154);
const converter = proj4("EPSG:2154");
const key = "c90xknypoz1flvgojchbphgt";
const prepackage_url = `https://wxs.ign.fr/${key}/telechargement/prepackage`;
const entry_url = `${prepackage_url}?request=GetCapabilities`;
const SIZE = 2000;


function create_dallage(resources) {
    let dallage = {
        "type": "FeatureCollection",
        "features": [],
    }

    for (let resource of resources) {
        var match_x_y = REGEX_X_Y.exec(resource.name);
        if (match_x_y) {
            var x_min = parseInt(match_x_y[1]) * 1000;
            var y_max = parseInt(match_x_y[2]) * 1000;
            var x_max = x_min + SIZE;
            var y_min = y_max - SIZE;

            dallage["features"].push({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            // on change la projection les coordonnées
                            converter.inverse([x_min, y_min]),
                            converter.inverse([x_max, y_min]),
                            converter.inverse([x_max, y_max]),
                            converter.inverse([x_min, y_max]),
                            converter.inverse([x_min, y_min]),
                        ]
                    ]
                },
                "properties": resource,
            });
        } else {
            console.error(resource.name);
        }
    }
    return dallage;
}

function get_resources(data, dataType) {
    // Récupération des ressources LidarHD
    var lidarHdResources = [];
    var resources = data.window.document.getElementsByTagName("Resources")[0].getElementsByTagName("Resource");
    for (let resource of resources) {
        var keyValue = {};
        for (let child of resource.childNodes) {
            if (child.tagName) {
                keyValue[child.tagName.toLowerCase()] = child.textContent;
            }
        }
        if (keyValue.name.toLowerCase().includes(dataType)) {
            lidarHdResources.push(keyValue);
        }
    }
    return lidarHdResources;
}

function get_files(data) {
    // Récupération des fichiers
    var files = [];
    var domFiles = data.window.document.getElementsByTagName("files")[0].getElementsByTagName("file");
    for (let domFile of domFiles) {
        var keyValue = {};
        for (let child of domFile.childNodes) {
            if (child.tagName) {
                keyValue[child.tagName] = child.textContent;
            }
        }
        files.push(keyValue);
    }
    return files;
}

var geojson = await fetch(entry_url)
    .then(function (response) {
        if (response.ok) {
            return response.text();
        } else {
            throw Error(response.statusText);
        }
    })
    .then(function (xml) {
        // On parse le document XML
        const data = new JSDOM(xml);

        // Récupération des ressources LidarHD
        var lidarHdResources = get_resources(data, DATA_TYPE);

        // Création du dallage
        var dallage = create_dallage(lidarHdResources);
        // console.log(dallage);
        return dallage;
    })
//fs.writeFileSync("grid_lidar_hd_ign.geojson", JSON.stringify(geojson), "utf-8");

const results = await Promise.all(geojson.features.map(async feat => {
    let name = feat.properties.name;
    let url = `${prepackage_url}/${name}`;
    // console.log(url);
    await limit()
    //await new Promise(resolve => setTimeout(resolve, 10000));
    // Requête
    const file = await fetch(url)
        .then(function (response) {
            if (response.ok) {
                return response.text();
            } else {
                throw Error(response.statusText);
            }
        })
        .then(function (xml) {
            // On parse le document XML
            let data = new JSDOM(xml);

            // Récupération des fichiers
            let files = get_files(data);
            return {
              filename: files[0].FILENAME,
              filesize: +files[0].FILESIZE,
              name: name
            }
        })
    // console.log(file);
    return file;
}))

var result_by_name = results.reduce((acc, current) => {
  acc[current.name] = current;
  return acc;
}, {});
//fs.writeFileSync("related_infos.json", JSON.stringify(results), "utf-8");

geojson.features = geojson.features.map(feat => {
  feat.properties.filesize = result_by_name[feat.properties.name].filesize
  feat.properties.url = `${prepackage_url}/${feat.properties.name}/file/${ result_by_name[feat.properties.name].filename }`
  return feat;
})

fs.writeFileSync("grid_lidar_hd_ign_with_related_infos.geojson", JSON.stringify(geojson), "utf-8");
