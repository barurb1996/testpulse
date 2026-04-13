Feature: User login

  Scenario: foo
    Given I am on the login page
    When I enter valid credentials
    Then I should see the dashboard

  Scenario: User logs in with a valid email and password and sees the dashboard
    Given I am on the login page
    When I enter valid credentials
    Then I should see the dashboard

  Scenario: User logs in with a valid email and password and lands on the dashboard
    Given I am on the login page
    When I enter valid credentials
    Then I should see the dashboard

  Scenario: Empty placeholder
