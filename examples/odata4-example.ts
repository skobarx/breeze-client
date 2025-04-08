/**
 * OData 4.0 Adapter Example
 * 
 * This example demonstrates how to use the OData 4.0 adapters with Breeze
 * to query and manipulate data from an OData 4.0 service.
 */

import * as breeze from 'breeze-client';
import { DataServiceOData4Adapter } from '../src/adapter-data-service-odata4';
import { UriBuilderOData4Adapter } from '../src/adapter-uri-builder-odata4';

// Register the OData 4.0 adapters
DataServiceOData4Adapter.register();
UriBuilderOData4Adapter.register();

// Create a data service that uses OData 4.0
// This example uses the public Northwind OData 4.0 service
const dataService = new breeze.DataService({
  serviceName: "https://services.odata.org/V4/Northwind/Northwind.svc/",
  adapterName: "OData4",
  uriBuilderName: "odata4"
});

// Create an EntityManager using the OData 4.0 data service
const manager = new breeze.EntityManager({ dataService });

// Example 1: Basic query
function queryCustomers() {
  console.log("Querying customers...");
  
  const query = new breeze.EntityQuery("Customers")
    .where("CompanyName", "startsWith", "A")
    .orderBy("CompanyName")
    .take(5);
  
  return manager.executeQuery(query)
    .then(result => {
      console.log(`Found ${result.results.length} customers starting with 'A':`);
      result.results.forEach(customer => {
        console.log(`- ${customer.CompanyName} (${customer.CustomerID})`);
      });
      return result.results;
    })
    .catch(error => {
      console.error("Error querying customers:", error);
      throw error;
    });
}

// Example 2: Query with inline count (uses $count=true in OData 4.0)
function queryCustomersWithCount() {
  console.log("\nQuerying customers with count...");
  
  const query = new breeze.EntityQuery("Customers")
    .where("Country", "eq", "Germany")
    .orderBy("CompanyName")
    .inlineCount();
  
  return manager.executeQuery(query)
    .then(result => {
      console.log(`Found ${result.inlineCount} total customers in Germany`);
      console.log(`Returned ${result.results.length} customers in this query batch`);
      return result;
    })
    .catch(error => {
      console.error("Error querying customers with count:", error);
      throw error;
    });
}

// Example 3: Query with expand (OData 4.0 expand)
function queryCustomersWithOrders() {
  console.log("\nQuerying customers with their orders...");
  
  const query = new breeze.EntityQuery("Customers")
    .where("CompanyName", "startsWith", "A")
    .expand("Orders")
    .take(2);
  
  return manager.executeQuery(query)
    .then(result => {
      const customers = result.results;
      customers.forEach(customer => {
        console.log(`${customer.CompanyName} has ${customer.Orders.length} orders`);
        if (customer.Orders.length > 0) {
          console.log(`  Latest order date: ${customer.Orders[0].OrderDate}`);
        }
      });
      return customers;
    })
    .catch(error => {
      console.error("Error querying customers with orders:", error);
      throw error;
    });
}

// Example 4: Query with OData 4.0 functions
function queryWithFunctions() {
  console.log("\nQuerying with OData 4.0 functions...");
  
  // In OData 4.0, 'contains' is used instead of 'substringof' 
  // and the parameter order is different
  const query = new breeze.EntityQuery("Customers")
    .where("contains(CompanyName, 'market')")
    .select("CustomerID, CompanyName, City, Country");
  
  return manager.executeQuery(query)
    .then(result => {
      console.log(`Found ${result.results.length} customers with 'market' in the name:`);
      result.results.forEach(customer => {
        console.log(`- ${customer.CompanyName} (${customer.City}, ${customer.Country})`);
      });
      return result.results;
    })
    .catch(error => {
      console.error("Error querying with functions:", error);
      throw error;
    });
}

// Example 5: Load metadata
function loadMetadata() {
  console.log("\nLoading metadata...");
  
  return manager.fetchMetadata()
    .then(() => {
      const metadataStore = manager.metadataStore;
      const entityTypes = metadataStore.getEntityTypes();
      
      console.log(`Loaded ${entityTypes.length} entity types from the service:`);
      entityTypes.forEach(entityType => {
        const properties = entityType.dataProperties.length + entityType.navigationProperties.length;
        console.log(`- ${entityType.shortName} (${properties} properties)`);
      });
      
      return entityTypes;
    })
    .catch(error => {
      console.error("Error loading metadata:", error);
      throw error;
    });
}

// Run the examples
async function runExamples() {
  try {
    // First, load the metadata
    await loadMetadata();
    
    // Then run the queries
    await queryCustomers();
    await queryCustomersWithCount();
    await queryCustomersWithOrders();
    await queryWithFunctions();
    
    console.log("\nAll examples completed successfully!");
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

// Start the examples when the module is executed
runExamples(); 