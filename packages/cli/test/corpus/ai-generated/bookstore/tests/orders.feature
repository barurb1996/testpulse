Feature: Orders API

  Background:
    * url baseUrl
    * def bookId = '11111111-1111-1111-1111-111111111111'

  Scenario: Place an order
    Given path 'orders'
    And header Authorization = 'Bearer ' + userToken
    And request { bookId: '#(bookId)', quantity: 2 }
    When method post
    Then status 201
    And match response.id == '#uuid'

  Scenario: Place an order without token
    Given path 'orders'
    And request { bookId: '#(bookId)', quantity: 2 }
    When method post
    Then status 401

  Scenario: Place an order with quantity zero
    Given path 'orders'
    And header Authorization = 'Bearer ' + userToken
    And request { bookId: '#(bookId)', quantity: 0 }
    When method post
    Then status 400

  Scenario: Place an order with quantity over the limit
    Given path 'orders'
    And header Authorization = 'Bearer ' + userToken
    And request { bookId: '#(bookId)', quantity: 21 }
    When method post
    Then status 400

  Scenario: Place an order with invalid book id
    Given path 'orders'
    And header Authorization = 'Bearer ' + userToken
    And request { bookId: 'not-a-uuid', quantity: 1 }
    When method post
    Then status 400

  Scenario: Place an order for out of stock book
    Given path 'orders'
    And header Authorization = 'Bearer ' + userToken
    And request { bookId: '22222222-2222-2222-2222-222222222222', quantity: 20 }
    When method post
    Then status 409

  Scenario: Get own order
    Given path 'orders'
    And header Authorization = 'Bearer ' + userToken
    And request { bookId: '#(bookId)', quantity: 1 }
    When method post
    Then status 201
    * def orderId = response.id

    Given path 'orders', orderId
    And header Authorization = 'Bearer ' + userToken
    When method get
    Then status 200
    And match response.id == orderId

  Scenario: Get an order of another user
    Given path 'orders'
    And header Authorization = 'Bearer ' + userToken
    And request { bookId: '#(bookId)', quantity: 1 }
    When method post
    Then status 201
    * def orderId = response.id

    Given path 'orders', orderId
    And header Authorization = 'Bearer ' + otherUserToken
    When method get
    Then status 403

  Scenario: Get an order without token
    Given path 'orders', '00000000-0000-0000-0000-000000000001'
    When method get
    Then status 401

  Scenario: Get a non-existing order
    Given path 'orders', '00000000-0000-0000-0000-000000000000'
    And header Authorization = 'Bearer ' + userToken
    When method get
    Then status 404
