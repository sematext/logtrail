var utils = require('./utils.js');

function getMessageTemplate(handlebar, selected_config) {
  var message_format = selected_config.fields.message_format;
  //Append <a> tags for click to message format except for message field
    var message_format_regex = /({{{(\S+)}}})/g; // e.g. {{pid}} : {{syslog_message}}
    var ng_click_template = handlebar.compile("<a class=\"ng-binding\" ng-click=\"onClick('{{name_no_braces}}','{{name}}')\">{{name}}</a>",
      {
      knownHelpers: {
        log: false,
        lookup: false
      },
      knownHelpersOnly: true
    });
    var messageField = "{{{" + selected_config.fields.mapping.message + "}}}";
    var message_template = message_format;

    var match = message_format_regex.exec(message_format);
    while (match !== null) {
      if (match[0] !== messageField) {
        var context = {
          name : match[0],
          name_no_braces : match[2]
        };        
        var with_click = ng_click_template(context);
        message_template = message_template.replace(match[0], with_click);
      }
      match = message_format_regex.exec(message_format);
    }
    return message_template; //<a class="ng-binding" ng-click="onClick('pid','{{pid}}')">{{pid}}</a> : {{syslog_message}}
}

function convertToClientFormat(selected_config, esResponse) {
  var clientResponse = [];
  var hits = esResponse.hits.hits;

  var message_format = selected_config.fields.message_format;
  if (message_format) {
    var handlebar = require('handlebars');
    var message_template = getMessageTemplate(handlebar, selected_config);
    var template = handlebar.compile(message_template, {
      knownHelpers: {
        log: false,
        lookup: false
      },
      knownHelpersOnly: true
    });
  }
  for (var i = 0; i < hits.length; i++) {
    var event = {};
    var source =  hits[i]._source;
    event.id = hits[i]._id;
    var get = require('lodash.get');
    event['timestamp'] = get(source, selected_config.fields.mapping['timestamp']);
    event['hostname'] = get(source, selected_config.fields.mapping['hostname']);
    event['program'] = get(source, selected_config.fields.mapping['program']);

    //Calculate message color, if configured
    if (selected_config.color_mapping && selected_config.color_mapping.field) {
      var color_field_val = get(source, selected_config.color_mapping.field);
      var color = selected_config.color_mapping.mapping[color_field_val];
      if (color) {
        event['color'] =  color;
      }
    }

    //Change the source['message'] to highlighter text if available
    if (hits[i].highlight) {
      var get = require('lodash.get');
      var set = require('lodash.set');
      var with_highlights = get(hits[i].highlight, [selected_config.fields.mapping['message'],0]);
      set(source, selected_config.fields.mapping['message'], with_highlights);
      source[selected_config.fields.mapping['message']] = hits[i].highlight[selected_config.fields.mapping['message']][0];
    }
    var message = source[selected_config.fields.mapping['message']];
    //sanitize html
    var escape = require('lodash.escape');
    message = escape(message);
    //if highlight is present then replace pre and post tag with html
    if (hits[i].highlight) {
      message = message.replace(/logtrail.highlight.pre_tag/g,'<span class="highlight">')
      message = message.replace(/logtrail.highlight.post_tag/g,'</span>')
    }
    source[selected_config.fields.mapping['message']] = message;

    //If the user has specified a custom format for message field
    if (message_format) {
      event['message'] = template(source);
    } else {
      event['message'] = message;
    }
    clientResponse.push(event);
  }
  return clientResponse;
}


module.exports = function (server) {
  //Search
  server.route({
    method: ['POST'],
    path: '/logtrail/search',
    handler: async function (request, reply) {
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      var selected_config = request.payload.config;
      var searchText = request.payload.searchText;
      var highlight = false;
      if (searchText == null || searchText.length === 0) {
          searchText = '*';
      }

      //If no time range is present get events based on default selected_config
      var timestamp = request.payload.timestamp;
      var rangeType = request.payload.rangeType;
      if (timestamp == null) {
        if (selected_config.default_time_range_in_days !== 0) {
          var moment = require('moment');
          timestamp = moment().subtract(
            selected_config.default_time_range_in_days,'days').startOf('day').valueOf();
          rangeType = 'gte';
        }
      }

      var indicesToSearch = await utils.getIndicesToSearch(selected_config.es.default_index, selected_config.fields.mapping.timestamp, timestamp, request, server);
      if (!indicesToSearch || indicesToSearch.length === 0) {
        reply({
          ok: false,
          message: "Empty indices to search."
        });
      }

      //Search Request bbody
      var searchRequest = {
        index: indicesToSearch.join(","),
        size: selected_config.max_buckets,
        body : {
          sort : [{}],
          query : {
              bool : {
                must :{
                    query_string : {
                      analyze_wildcard: true,
                      default_field : selected_config.fields.mapping['message'],
                      query : searchText,
                      default_operator: 'AND'
                    }
                },
                filter: {
                  bool : {
                    must : [
                    ],
	                  must_not:[],
                  }
                }
            }
          }
        }
      };

      if (searchText !== "*") {
        searchRequest.body['highlight'] = {
          pre_tags : ["logtrail.highlight.pre_tag"],
          post_tags : ["logtrail.highlight.post_tag"],
          fields : {
          }
        };
        //Enable highlightng on message field
        searchRequest.body.highlight.fields[selected_config.fields.mapping['message']] = {
          number_of_fragments: 0
        };
      }

      //By default Set sorting column to timestamp
      searchRequest.body.sort[0][selected_config.fields.mapping.timestamp] = {'order':request.payload.order ,'unmapped_type': 'boolean'};

      //If hostname is present then term query.
      if (request.payload.hostname != null) {
        var termQuery = {
          term : {
          }
        };
        var hostnameField = selected_config.fields.mapping.hostname;
        if (selected_config.fields['hostname_keyword']) {
          hostnameField += '.raw';
        }
        termQuery.term[hostnameField] = request.payload.hostname;
        searchRequest.body.query.bool.filter.bool.must.push(termQuery);
      }

      //If timestamps are present set ranges
      if (timestamp != null) {
        var rangeQuery = {
          range : {

          }
        };
        var range = rangeQuery.range;
        range[selected_config.fields.mapping.timestamp] = {};
        range[selected_config.fields.mapping.timestamp][rangeType] = timestamp;
        range[selected_config.fields.mapping.timestamp].format = 'epoch_millis';
        searchRequest.body.query.bool.filter.bool.must.push(rangeQuery);
      }
      //console.log(JSON.stringify(searchRequest));
      callWithRequest(request,'search',searchRequest).then(function (resp) {
        reply({
          ok: true,
          resp: convertToClientFormat(selected_config, resp)
        });
      }).catch(function (resp) {
        console.error("Error while executing search",resp);
        if (resp.isBoom) {
          reply(resp);
        } else {
          reply({
            ok: false,
            resp: resp
          });
        }
      });
    }
  });

 //Get All Systems
  server.route({
    method: ['POST'],
    path: '/logtrail/hosts',
    handler: async function (request,reply) {
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      var index = request.payload.index;
      var selected_config = request.payload.config;
      var moment = require('moment');
      var timestamp = moment().subtract(
            selected_config.default_time_range_in_days,'days').startOf('day').valueOf();
          
      var indicesToSearch = await utils.getIndicesToSearch(selected_config.es.default_index, 
        selected_config.fields.mapping.timestamp, timestamp, request, server);
      if (!indicesToSearch || indicesToSearch.length === 0) {
        reply({
          ok: false,
          message: "Empty indices to search."
        });
      }

      var hostnameField = selected_config.fields.mapping.hostname;
      if (selected_config.fields['hostname_keyword']) {
        hostnameField += '.raw';
      }
      var hostAggRequest = {
        index: indicesToSearch.join(","),
        body : {
          size: 0,
          aggs: {
            hosts: {
              terms: {
                field: hostnameField,
                size: selected_config.max_hosts
              }
            }
          }
        }
      };
      //console.log(JSON.stringify(hostAggRequest));
      callWithRequest(request,'search',hostAggRequest).then(function (resp) {
      //console.log(JSON.stringify(resp));//.aggregations.hosts.buckets);
        reply({
          ok: true,
          resp: resp.aggregations.hosts.buckets
        });
      }).catch(function (resp) {
        if(resp.isBoom) {
          reply(resp);
        } else {
          console.error("Error while fetching hosts",resp);
          reply({
            ok: false,
            resp: resp
          });
        }
      });
    }
  });
};