Feature: Helpdesk Tickets API - comments

  Background:
    * url baseUrl
    * def created = call read('classpath:helpers/create-ticket.feature')
    * def ticketId = created.ticketId

  Scenario: Requester adds a comment to own ticket
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + requesterToken
    And request { body: 'Any update on this?' }
    When method post
    Then status 201
    And match response.body == 'Any update on this?'

  Scenario: Agent adds a comment
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + agentToken
    And request { body: 'We are looking into it.' }
    When method post
    Then status 201
    And match response.body == 'We are looking into it.'

  Scenario: Comment with minimum length body is accepted
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + requesterToken
    And request { body: 'a' }
    When method post
    Then status 201

  Scenario: Comment with maximum length body is accepted
    * def maxBody = new Array(2001).join('a')
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + requesterToken
    And request { body: '#(maxBody)' }
    When method post
    Then status 201

  Scenario: Comment with empty body is rejected
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + requesterToken
    And request { body: '' }
    When method post
    Then status 400

  Scenario: Comment without body field is rejected
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + requesterToken
    And request {}
    When method post
    Then status 400

  Scenario: Comment with too long body is rejected
    * def longBody = new Array(2002).join('a')
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + requesterToken
    And request { body: '#(longBody)' }
    When method post
    Then status 400

  Scenario: Comment without token is rejected
    Given path 'tickets', ticketId, 'comments'
    And request { body: 'Hello' }
    When method post
    Then status 401

  Scenario: Comment on someone else's ticket is forbidden
    Given path 'tickets', ticketId, 'comments'
    And header Authorization = 'Bearer ' + otherRequesterToken
    And request { body: 'Hello' }
    When method post
    Then status 403
