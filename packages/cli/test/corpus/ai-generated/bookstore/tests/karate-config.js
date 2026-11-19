function fn() {
  var config = {
    baseUrl: karate.properties['baseUrl'] || 'https://api.books.example.com',
    adminToken: karate.properties['adminToken'] || 'admin-token',
    userToken: karate.properties['userToken'] || 'user-token',
    otherUserToken: karate.properties['otherUserToken'] || 'other-user-token'
  };
  karate.configure('connectTimeout', 5000);
  karate.configure('readTimeout', 10000);
  return config;
}
