Feature: Helpdesk Tickets API - closing tickets

  Background:
    * url baseUrl
    * def created = call read('classpath:helpers/create-ticket.feature')
    * def ticketId = created.ticketId

  Scenario: Agent closes a ticket
    Given path 'tickets', ticketId, 'close'
    And header Authorization = 'Bearer ' + agentToken
    When method post
    Then status 200

    Given path 'tickets', ticketId
    And header Authorization = 'Bearer ' + agentToken
    When method get
    Then status 200
    And match response.status == 'CLOSED'

  Scenario: Closing an already closed ticket returns conflict
    Given path 'tickets', ticketId, 'close'
    And header Authorization = 'Bearer ' + agentToken
    When method post
    Then status 200

    Given path 'tickets', ticketId, 'close'
    And header Authorization = 'Bearer ' + agentToken
    When method post
    Then status 409

  Scenario: Requester cannot close a ticket
    Given path 'tickets', ticketId, 'close'
    And header Authorization = 'Bearer ' + requesterToken
    When method post
    Then status 403

  Scenario: Close without token is rejected
    Given path 'tickets', ticketId, 'close'
    When method post
    Then status 401

  Scenario: Close non-existent ticket returns 404
    Given path 'tickets', '00000000-0000-4000-8000-000000000000', 'close'
    And header Authorization = 'Bearer ' + agentToken
    When method post
    Then status 404
