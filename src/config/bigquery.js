const { BigQuery } = require('@google-cloud/bigquery');

const bigquery = new BigQuery({
  projectId: 'kn-ar-int-svc-prsnl-plans-prod',
  location: 'southamerica-east1'
});

module.exports = { bigquery };