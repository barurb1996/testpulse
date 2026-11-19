Feature: Loans

Scenario: creates a loan
  Given url 'https://api.example.com'
  And path '/api/loans'
  And header Authorization = 'Bearer ' + token
  And request { principal: 5000, currency: 'EUR' }
  When method post
  Then status 201

Scenario: rejects loan creation without token
  Given url 'https://api.example.com'
  And path '/api/loans'
  And request { principal: 5000 }
  When method post
  Then status 401

Scenario: gets own loan
  Given url 'https://api.example.com'
  And path '/api/loans/123'
  And header Authorization = 'Bearer ' + token
  When method get
  Then status 200

Scenario: calls a hidden admin endpoint
  Given url 'https://api.example.com'
  And path '/api/admin/purge'
  When method post
  Then status 200
