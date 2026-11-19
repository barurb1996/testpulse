Feature: Books API

  Background:
    * url baseUrl

  Scenario: List books
    Given path 'books'
    When method get
    Then status 200
    And match response == '#array'

  Scenario: List books with limit
    Given path 'books'
    And param limit = 5
    When method get
    Then status 200
    And match response == '#[_ <= 5]'

  Scenario: Create a book as admin
    Given path 'books'
    And header Authorization = 'Bearer ' + adminToken
    And request { title: 'Clean Code', isbn: '9780132350884', price: 39.99 }
    When method post
    Then status 201
    And match response.title == 'Clean Code'
    And match response.isbn == '9780132350884'

  Scenario: Create a book without token
    Given path 'books'
    And request { title: 'Clean Code', isbn: '9780132350884', price: 39.99 }
    When method post
    Then status 401

  Scenario: Create a book as regular user
    Given path 'books'
    And header Authorization = 'Bearer ' + userToken
    And request { title: 'Clean Code', isbn: '9780132350884', price: 39.99 }
    When method post
    Then status 403

  Scenario: Create a book with invalid isbn
    Given path 'books'
    And header Authorization = 'Bearer ' + adminToken
    And request { title: 'Clean Code', isbn: '123', price: 39.99 }
    When method post
    Then status 400

  Scenario: Create a book with negative price
    Given path 'books'
    And header Authorization = 'Bearer ' + adminToken
    And request { title: 'Clean Code', isbn: '9780132350884', price: -1 }
    When method post
    Then status 400

  Scenario: Get a book
    Given path 'books'
    And header Authorization = 'Bearer ' + adminToken
    And request { title: 'Refactoring', isbn: '9780134757599', price: 44.5 }
    When method post
    Then status 201
    * def bookId = response.id

    Given path 'books', bookId
    When method get
    Then status 200
    And match response.title == 'Refactoring'

  Scenario: Get a non-existing book
    Given path 'books', '00000000-0000-0000-0000-000000000000'
    When method get
    Then status 404

  Scenario: Update a book as admin
    Given path 'books'
    And header Authorization = 'Bearer ' + adminToken
    And request { title: 'Old Title', isbn: '9780321125217', price: 50 }
    When method post
    Then status 201
    * def bookId = response.id

    Given path 'books', bookId
    And header Authorization = 'Bearer ' + adminToken
    And request { title: 'New Title', isbn: '9780321125217', price: 55 }
    When method put
    Then status 200
    And match response.title == 'New Title'
    And match response.price == 55

  Scenario: Update a book as regular user
    Given path 'books', '00000000-0000-0000-0000-000000000001'
    And header Authorization = 'Bearer ' + userToken
    And request { title: 'New Title', isbn: '9780321125217', price: 55 }
    When method put
    Then status 403

  Scenario: Update a book with invalid body
    Given path 'books', '00000000-0000-0000-0000-000000000001'
    And header Authorization = 'Bearer ' + adminToken
    And request { title: '', isbn: 'abc', price: 55 }
    When method put
    Then status 400

  Scenario: Delete a book as admin
    Given path 'books'
    And header Authorization = 'Bearer ' + adminToken
    And request { title: 'To Delete', isbn: '9780201633610', price: 20 }
    When method post
    Then status 201
    * def bookId = response.id

    Given path 'books', bookId
    And header Authorization = 'Bearer ' + adminToken
    When method delete
    Then status 204

    Given path 'books', bookId
    When method get
    Then status 404

  Scenario: Delete a book without token
    Given path 'books', '00000000-0000-0000-0000-000000000001'
    When method delete
    Then status 401

  Scenario: Delete a non-existing book
    Given path 'books', '00000000-0000-0000-0000-000000000000'
    And header Authorization = 'Bearer ' + adminToken
    When method delete
    Then status 404
