Feature: Fixture shop
  Every step below is copied from the catalog that testid-scan-bdd writes for shop.html.

  Background:
    Given I am on the "shop.html" page

  Scenario: Products and the cart
    When I fill the "Search products" field with "lamp"
    And I click the "Add to favorites" button
    Then I see the "Remove from favorites" button
    When I click the "Add to cart" button in the "Chair" item
    Then I see the text "Added Chair to the cart"
    When I click the "Remove" button in the "Lamp in cart" item
    Then I do not see the "Lamp in cart" item
    And I see the "Desk in cart" item

  Scenario: Options, test IDs and table rows
    When I check the "Gift wrap" checkbox
    Then the "Gift wrap" checkbox is checked
    When I select "Express" in the "Shipping" dropdown
    Then I see the text "Shipping: Express"
    When I click the "open menu" button
    Then I see the "Help" link
    When I click the "delete all" button
    Then I see the text "Deleted all"
    When I click the "Open" button in the "1043" row
    Then I see the text "Opened order 1043"
