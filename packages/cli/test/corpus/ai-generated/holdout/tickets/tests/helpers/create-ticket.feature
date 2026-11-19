@ignore
Feature: Helper - create a ticket as requester

  Scenario:
    Given url baseUrl
    And path 'tickets'
    And header Authorization = 'Bearer ' + requesterToken
    And request { subject: 'Helper created ticket', priority: 'MEDIUM', description: 'Created by test helper' }
    When method post
    Then status 201
    * def ticketId = response.id
