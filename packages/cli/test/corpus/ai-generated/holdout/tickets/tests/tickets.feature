Feature: Helpdesk Tickets API - tickets

  Background:
    * url baseUrl

  Scenario: List tickets as requester
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    When method get
    Then status 200
    And match response == '#array'

  Scenario: List tickets filtered by status OPEN
    Given path 'tickets'
    And param status = 'OPEN'
    And header Authorization = 'Bearer ' + requesterToken
    When method get
    Then status 200
    And match each response contains { status: 'OPEN' }

  Scenario: List tickets filtered by status CLOSED
    Given path 'tickets'
    And param status = 'CLOSED'
    And header Authorization = 'Bearer ' + requesterToken
    When method get
    Then status 200
    And match each response contains { status: 'CLOSED' }

  Scenario: List tickets without token is rejected
    Given path 'tickets'
    When method get
    Then status 401

  Scenario Outline: Create ticket with priority <priority>
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: 'Printer is broken', priority: '<priority>', description: 'Paper jam on floor 2' }
    When method post
    Then status 201
    And match response.id == '#uuid'
    And match response.subject == 'Printer is broken'
    And match response.priority == '<priority>'

    Examples:
      | priority |
      | LOW      |
      | MEDIUM   |
      | HIGH     |
      | URGENT   |

  Scenario: Create ticket without description
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: 'No description here', priority: 'LOW' }
    When method post
    Then status 201
    And match response.id == '#uuid'

  Scenario: Create ticket without token is rejected
    Given path 'tickets'
    And request { subject: 'Printer is broken', priority: 'LOW' }
    When method post
    Then status 401

  Scenario: Create ticket without subject is rejected
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { priority: 'LOW' }
    When method post
    Then status 400

  Scenario: Create ticket without priority is rejected
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: 'Missing priority' }
    When method post
    Then status 400

  Scenario: Create ticket with invalid priority is rejected
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: 'Bad priority', priority: 'CRITICAL' }
    When method post
    Then status 400

  Scenario: Create ticket with too short subject is rejected
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: 'abcd', priority: 'LOW' }
    When method post
    Then status 400

  Scenario: Create ticket with too long subject is rejected
    * def longSubject = new Array(122).join('a')
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: '#(longSubject)', priority: 'LOW' }
    When method post
    Then status 400

  Scenario: Create ticket with subject at length boundaries
    * def minSubject = 'abcde'
    * def maxSubject = new Array(121).join('a')
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: '#(minSubject)', priority: 'LOW' }
    When method post
    Then status 201
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: '#(maxSubject)', priority: 'LOW' }
    When method post
    Then status 201

  Scenario: Create ticket with too long description is rejected
    * def longDescription = new Array(5002).join('a')
    Given path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: 'Long description', priority: 'LOW', description: '#(longDescription)' }
    When method post
    Then status 400

  Scenario: Get own ticket
    * def created = call read('classpath:helpers/create-ticket.feature')
    Given path 'tickets', created.ticketId
    And header Authorization = 'Bearer ' + requesterToken
    When method get
    Then status 200
    And match response.id == created.ticketId

  Scenario: Agent can get any ticket
    * def created = call read('classpath:helpers/create-ticket.feature')
    Given path 'tickets', created.ticketId
    And header Authorization = 'Bearer ' + agentToken
    When method get
    Then status 200
    And match response.id == created.ticketId

  Scenario: Get ticket without token is rejected
    Given path 'tickets', '3f2b8c1e-5a47-4c0e-9d1b-6a7f2e8b9c10'
    When method get
    Then status 401

  Scenario: Get someone else's ticket is forbidden
    * def created = call read('classpath:helpers/create-ticket.feature')
    Given path 'tickets', created.ticketId
    And header Authorization = 'Bearer ' + otherRequesterToken
    When method get
    Then status 403

  Scenario: Get non-existent ticket returns 404
    Given path 'tickets', '00000000-0000-4000-8000-000000000000'
    And header Authorization = 'Bearer ' + agentToken
    When method get
    Then status 404
