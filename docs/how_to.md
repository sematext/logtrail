#### 1. Hostname field need to be of type keyword

Logtrail uses aggregate query to fetch list of hosts. Aggregation requires the hostname field to be of type keyword.

If the index pattern starts with `logstash-*`, by default logstash will manage the templates. Default logstash template adds `.keyword` fields. When the index pattern is different, logstash does not manage the template. When not using `logstash-*` pattern, you can specify the template using `template` field in elastic output. 

You can download and reuse default logstash templates from following location. Make sure to change the `template` key in below json files to match the index pattern.

Elasticsearch 6.x : [https://github.com/logstash-plugins/logstash-output-elasticsearch/blob/master/lib/logstash/outputs/elasticsearch/elasticsearch-template-es6x.json](https://github.com/logstash-plugins/logstash-output-elasticsearch/blob/master/lib/logstash/outputs/elasticsearch/elasticsearch-template-es6x.json)

Elasticsearch 5.x : [https://github.com/logstash-plugins/logstash-output-elasticsearch/blob/master/lib/logstash/outputs/elasticsearch/elasticsearch-template-es5x.json](https://github.com/logstash-plugins/logstash-output-elasticsearch/blob/master/lib/logstash/outputs/elasticsearch/elasticsearch-template-es5x.json)

```ruby
	elasticsearch {
		index => "<index-pattern>"
		template => "elasticsearch-template-es6x.json"
	}
```

Filebeat template makes beat.hostname field type as keyword.

While using other ingesters like Fluentd etc, you need to create temapltes with required mappings. For more info checkout https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-templates.html

#### 2. Update kibana.version in logtrail plugin archive

To update Logtrail plugin to work with your Kibana version, unzip the current logtrail plugin archive and update `kibana.version` in `package.json` to your current version of Kibana. Zip the contents again and install the updated archive. This should work across minor Kibana versions, provided there are no API mismatch between Kibana API used by Logtrail.

```json
{
  "name": "logtrail",
  "version": "0.1.26",
  "description": "Plugin to view, search & tail logs in Kibana",
  "main": "index.js",
  "kibana": {
    "version": "6.2.2"
  },
 }

```

#### 3. Load Logtrail configuration from Elasticsearch

Logtrail can read the configuration from Elasticsearch instead of local `logtrail.json` file. During Kibana startup, Logtrail will look for configuration at `.logtrail` index in Elasticsearch. If available it will use the configuration from this index instead of local `logtrail.json` file. You can upload the contents of `logtrail.json` to Elasticsearch using following command:
```sh
curl -XPUT 'localhost:9200/.logtrail/config/1?pretty' -H 'Content-Type: application/json' -d@<path_to_logtrail.json_file>
```
Make sure the Kibana user has read permissions for `.logtrail` index.
