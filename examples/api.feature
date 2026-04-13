Feature: Payment API

Scenario: test
  Given url 'https://api.example.com'
  When method get
  And path '/ping'

Scenario: verifies that POST /payments returns 201 and a transaction id
  Given url 'https://api.example.com'
  And header Content-Type = 'application/json'
  When method post
  And path '/payments'
  And request { amount: 100, currency: 'EUR' }
  Then status 201
  And match response.transactionId == '#string'

Scenario: foo
  Given url 'https://api.example.com'
  When method get
  And path '/health'
  Then status 200
