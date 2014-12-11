/*
 * Flush stats to ElasticSearch (http://www.elasticsearch.org/)
 *
 * To enable this backend, include 'elastic' in the backends
 * configuration array:
 *
 *   backends: ['./backends/elastic'] 
 *  (if the config file is in the statsd folder)
 *
 * A sample configuration can be found in exampleElasticConfig.js
 *
 * This backend supports the following config options:
 *
 *   host:          hostname or IP of ElasticSearch server
 *   port:          port of Elastic Search Server
 *   path:          http path of Elastic Search Server (default: '/')
 *   indexPrefix:   Prefix of the dynamic index to be created (default: 'statsd')
 *   indexType:     The dociment type of the saved stat (default: 'stat')
 */

var net = require('net'),
  util = require('util'),
  http = require('http');

var debug;
var flushInterval;
var elasticHost;
var elasticPort;
var elasticPath;
var elasticIndex;
var elasticCountType;
var elasticTimerType;
var elasticTimerDataType;

var elasticStats = {};

var KEY_NAMES = {
  //default: ["action", "process", "group", "namespace"],
  groveStats: ["stat", "module", "customer", "grove"],
  statsdStats: ["stat", "process"]
};

var es_bulk_insert = function elasticsearch_bulk_insert(listCounters, listTimers, listTimerData) {

  var indexDate = new Date();
  var indexMo = indexDate.getUTCMonth() + 1;
  if (indexMo < 10) {
    indexMo = '0' + indexMo;
  }
  var indexDt = indexDate.getUTCDate();
  if (indexDt < 10) {
    indexDt = '0' + indexDt;
  }

  var statsdIndex = elasticIndex + '-' + indexDate.getUTCFullYear() + '.' + indexMo + '.' + indexDt;
  var payload = '';

  var payloadBuilder = function(list, payload, index, type) {
    for (key in list) {
      payload += '{"index":{"_index":"' + index + '","_type":"' + type + '"}}' + "\n";
      payload += '{';
      var innerPayload = '';
      for (statKey in list[key]) {
        if (innerPayload) {
          innerPayload += ',';
        }
        innerPayload += '"' + statKey + '":"' + list[key][statKey] + '"';
      }
      payload += innerPayload + '}' + "\n";
    }

    return payload;
  };

  payload = payloadBuilder(listCounters, payload, statsdIndex, elasticCountType);
  payload = payloadBuilder(listTimers, payload, statsdIndex, elasticTimerType);
  payload = payloadBuilder(listTimerData, payload, statsdIndex, elasticTimerDataType);

  var optionsPost = {
    host: elasticHost,
    port: elasticPort,
    path: elasticPath + statsdIndex + '/' + '/_bulk',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    }
  };
  var req = http.request(optionsPost, function (res) {
    res.on('data', function (d) {
      if (Math.floor(res.statusCode / 100) == 5) {
        var errdata = "HTTP " + res.statusCode + ": " + d;
        console.log(errdata);
      }
    });
  });

  if (debug) {
    console.log(payload);
  }
  req.write(payload);
  req.end();
}

var flush_stats = function elastic_flush(ts, metrics) {
  console.log(JSON.stringify(metrics));
  var statString = '';
  var numStats = 0;
  var key;
  var array_counts = new Array();
  var array_timers = new Array();
  var array_timer_data = new Array();

  var getKeyNames = function(nameArray){
    var keyNames;
    if (nameArray[nameArray.length - 1] === 'statsd') {
      keyNames = KEY_NAMES["statsdStats"];
    } else {
      keyNames = KEY_NAMES["groveStats"];
    }

    return keyNames;
  };

  ts = ts * 1000;
  /*
   var gauges = metrics.gauges;
   var pctThreshold = metrics.pctThreshold;
   */

  for (key in metrics.counters) {

    var listKeys = key.split('.').reverse();
    var keyNames = getKeyNames(listKeys);

    var value = metrics.counters[key];
    var statObj = {};
    for (var i=0; i < listKeys.length; i++) {
      statObj[keyNames[i]] = listKeys[i];
    }
    statObj["value"] = value;
    statObj["@timestamp"] = ts;

    array_counts.push(statObj);

    numStats += 1;
  }

  /*
  for (key in metrics.timers) {
    var listKeys = key.split('.');
    var series = metrics.timers[key];
    for (keyTimer in series) {
      array_timers.push({
        "ns": listKeys[0] || '',
        "grp": listKeys[1] || '',
        "tgt": listKeys[2] || '',
        "act": listKeys[3] || '',
        "val": series[keyTimer],
        "@timestamp": ts
      });
    }
  }*/

  /*
  for (key in metrics.timer_data) {
    var listKeys = key.split('.');
    var value = metrics.timer_data[key];
    value["@timestamp"] = ts;
    value["ns"] = listKeys[0] || '';
    value["grp"] = listKeys[1] || '';
    value["tgt"] = listKeys[2] || '';
    value["act"] = listKeys[3] || '';
    if (value['histogram']) {
      for (var keyH in value['histogram']) {
        value[keyH] = value['histogram'][keyH];
      }
      delete value['histogram'];
    }
    array_timer_data.push(value);
    numStats += 1;
  }*/

  /*
   for (key in gauges) {
   message_array.push(create_json(key + '.gauges' , gauges[key],ts));
   numStats += 1;
   }
   */

  es_bulk_insert(array_counts, array_timers, array_timer_data);

  if (debug) {
    console.log("flushed " + numStats + " stats to ES");
  }
};

var elastic_backend_status = function graphite_status(writeCb) {
  for (stat in elasticStats) {
    writeCb(null, 'elastic', stat, elasticStats[stat]);
  }
};

exports.init = function elasticsearch_init(startup_time, config, events) {

  debug = config.debug;

  var configEs = config.elasticsearch || {};

  elasticHost = configEs.host || 'localhost';
  elasticPort = configEs.port || 9200;
  elasticPath = configEs.path || '/';
  elasticIndex = configEs.indexPrefix || 'statsd';
  elasticCountType = configEs.countType || 'counter';
  elasticTimerType = configEs.timerType || 'timer';
  elasticTimerDataType = configEs.timerDataType || 'timer_stats';
  flushInterval = config.flushInterval;

  elasticStats.last_flush = startup_time;
  elasticStats.last_exception = startup_time;


  events.on('flush', flush_stats);
  events.on('status', elastic_backend_status);

  return true;
};

