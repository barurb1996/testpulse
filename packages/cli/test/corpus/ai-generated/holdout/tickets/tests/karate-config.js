function fn() {
  var config = {
    baseUrl: karate.properties['baseUrl'] || 'https://api.helpdesk.example.com',
    requesterToken: karate.properties['requesterToken'] || java.lang.System.getenv('REQUESTER_TOKEN'),
    otherRequesterToken: karate.properties['otherRequesterToken'] || java.lang.System.getenv('OTHER_REQUESTER_TOKEN'),
    agentToken: karate.properties['agentToken'] || java.lang.System.getenv('AGENT_TOKEN')
  };
  karate.configure('connectTimeout', 5000);
  karate.configure('readTimeout', 10000);
  return config;
}
