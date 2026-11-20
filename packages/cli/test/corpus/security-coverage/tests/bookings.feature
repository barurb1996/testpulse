Feature: Bookings

Scenario: creates a booking
  Given url 'https://api.example.com'
  And path '/api/bookings'
  And header Authorization = 'Bearer ' + token
  And request { amount: 5000, currency: 'EUR' }
  When method post
  Then status 201

Scenario: rejects booking creation without token
  Given url 'https://api.example.com'
  And path '/api/bookings'
  And request { amount: 5000 }
  When method post
  Then status 401

Scenario: gets own booking
  Given url 'https://api.example.com'
  And path '/api/bookings/123'
  And header Authorization = 'Bearer ' + token
  When method get
  Then status 200

Scenario: calls a hidden admin endpoint
  Given url 'https://api.example.com'
  And path '/api/admin/purge'
  When method post
  Then status 200
