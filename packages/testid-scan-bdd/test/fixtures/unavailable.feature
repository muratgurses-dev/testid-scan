Feature: Steps that must fail
  The e2e script expects both scenarios to fail, with these errors.

  Scenario: An element the catalog lists as not available
    Given I am on the "shop.html" page
    When I click the "Compare" button

  Scenario: A removed item is still expected
    Given I am on the "shop.html" page
    When I click the "Remove" button in the "Lamp in cart" item
    Then I see the "Lamp in cart" item
