exports.getIndicesToSearch = function(index, timestampField, fromTimestamp, request, server) {
  return new Promise((resolve, reject) => {
    const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
    var fieldStatsRequest = {
      index: index,
      level: "indices",
      body : {
        fields : [ timestampField ],
        index_constraints: {
        }
      }
    };
    if (fromTimestamp) {
      var constraints = {
        max_value: {
          gte: fromTimestamp,
          format: "epoch_millis"
        }
      }
      fieldStatsRequest.body.index_constraints[timestampField] = constraints;
    } else {
      delete fieldStatsRequest.body.index_constraints;
    }
    
    callWithRequest(request,'fieldStats',fieldStatsRequest).then(function (resp) {
      var indicesToSearch = [];
      var items = [];
      if (resp.indices) {
        for (var index in resp.indices) {
          var item = {
            index: index,
            max_value : resp.indices[index].fields[timestampField].max_value
          }
          items.push(item);
        }
        items.sort(function (i1, i2) {
          return i2.max_value - i1.max_value;
        });
        for (var i=0; i < items.length; i++) {
          indicesToSearch.push(items[i].index);
        }
      }
      resolve(indicesToSearch);
    }).catch(function (resp) {
      console.error("Error while fetch indices to search:" + JSON.stringify(resp));
      resolve(null);
    });
  });
}