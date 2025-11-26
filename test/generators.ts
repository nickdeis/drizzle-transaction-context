import { faker } from "@faker-js/faker";
export function customer() {
  return {
    name: faker.person.fullName(),
    age: faker.number.int({ min: 21, max: 80 }),
    email: faker.internet.email(),
  };
}

export function order<T>(customer_id: T) {
  return {
    customer_id,
    order_total: faker.number.float({ min: 0, max: 100000 }),
  };
}

export function item<T>(order_id: T) {
  return {
    order_id,
    item_quantity: faker.number.int({ min: 1, max: 100 }),
    item_name: faker.commerce.product(),
  };
}
