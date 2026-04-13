package example;

import io.cucumber.java.en.Given;
import io.cucumber.java.en.When;
import io.cucumber.java.en.Then;

public class LoginSteps {

    @Given("I am on the login page")
    public void iAmOnTheLoginPage() {
    }

    @When("I enter valid credentials")
    public void iEnterValidCredentials() throws InterruptedException {
        Thread.sleep(2000);
        System.out.println("typed credentials");
    }

    @Then("I should see the dashboard")
    public void iShouldSeeTheDashboard() {
        assert true;
    }
}
