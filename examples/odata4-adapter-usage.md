# Using OData 4.0 Adapters in Breeze

This document explains how to use the OData 4.0 adapters with Breeze.

## Introduction

Breeze supports OData 4.0 services through a set of adapters that convert Breeze queries to OData 4.0 format and handle the specific protocol requirements of OData 4.0.

## Key Differences Between OData 3.0 and OData 4.0

OData 4.0 has several differences from OData 3.0:

1. Headers:
   - OData 4.0 uses `OData-Version: 4.0` instead of `DataServiceVersion: 2.0`

2. Query Parameters:
   - OData 4.0 uses `$count=true` instead of `$inlinecount=allpages`
   - OData 4.0 has more advanced `$expand` options supporting nested selection

3. Function Names:
   - `substringof(text, property)` is replaced with `contains(property, text)` (parameter order flipped)
   - Boolean functions no longer need the `eq true` suffix

4. Response Format:
   - OData 4.0 uses `@odata.count` instead of `__count`
   - OData 4.0 uses `value` array for collections instead of `results`
   - OData 4.0 uses `@odata.type` instead of `__metadata.type`

5. Batch Requests:
   - OData 4.0 uses a different multipart format for batch operations

## Installation

The OData 4.0 adapters are included in the Breeze client package.

## Registering the Adapters

You need to register both the Data Service adapter and the URI Builder adapter:

```typescript
import { DataServiceOData4Adapter } from './src/adapter-data-service-odata4';
import { UriBuilderOData4Adapter } from './src/adapter-uri-builder-odata4';

// Register the adapters
DataServiceOData4Adapter.register();
UriBuilderOData4Adapter.register();
```

Or use the convenience function:

```typescript
import { registerOData4Adapters } from './adapter-odata4';

// Register all OData 4.0 adapters
registerOData4Adapters();
```

## Creating a Data Service

When creating your data service, specify the OData 4.0 adapters:

```typescript
import * as breeze from 'breeze-client';

const dataService = new breeze.DataService({
  serviceName: "https://services.odata.org/V4/Northwind/Northwind.svc/",
  adapterName: "OData4",
  uriBuilderName: "odata4"
});

// Use the data service with an EntityManager
const manager = new breeze.EntityManager({ dataService });
```

## Example Queries

Queries work just like with OData 3.0, but they'll be translated to OData 4.0 format:

```typescript
// Query customers with a filter
const query = new breeze.EntityQuery("Customers")
  .where("CompanyName", "startsWith", "A")
  .orderBy("CompanyName")
  .take(5);

// With inline count (uses $count=true in OData 4.0)
const queryWithCount = query.inlineCount();

// With expand (OData 4.0 format)
const queryWithExpand = query.expand("Orders");

// Execute the query
manager.executeQuery(query).then(result => {
  const customers = result.results;
  console.log(customers);
});
```

## Handling OData 4.0 Metadata

The OData 4.0 adapter handles reading metadata from OData 4.0 services. To load metadata:

```typescript
manager.fetchMetadata().then(() => {
  console.log("Metadata loaded");
}).catch(error => {
  console.error("Error loading metadata:", error);
});
```

## Saving Changes

The OData 4.0 adapter also handles saving changes to OData 4.0 services:

```typescript
// Create a new customer
const customer = manager.createEntity("Customer", {
  CustomerId: breeze.core.getUuid(),
  CompanyName: "New Company"
});

// Save changes
manager.saveChanges().then(saveResult => {
  console.log("Save successful");
  console.log("Entities saved:", saveResult.entities);
}).catch(error => {
  console.error("Error saving:", error);
});
```

## Advanced Usage

### Custom Request Headers

You can customize the headers sent to the OData 4.0 service:

```typescript
// Get the data service adapter instance
const dataServiceAdapter = breeze.config.getAdapterInstance("dataService", "OData4");

// Add custom headers
dataServiceAdapter.headers["CustomHeader"] = "CustomValue";
```

### Custom URL Handling

You can configure how URLs are constructed:

```typescript
const dataServiceAdapter = breeze.config.getAdapterInstance("dataService", "OData4");

// Use relative URLs
dataServiceAdapter.relativeUrl = true;

// Or provide a custom URL builder function
dataServiceAdapter.relativeUrl = (dataService, url) => {
  return `${dataService.serviceName}/api/${url}`;
};
```

## Troubleshooting

### Common Issues

1. **Error: Metadata retrieval failed**
   - Make sure your OData 4.0 service endpoint is correct
   - Check that the service supports OData 4.0 metadata

2. **Query returns unexpected results**
   - Verify that your service supports the OData 4.0 query options you're using
   - Some OData 4.0 services might have limitations on query capabilities

3. **Save operation fails**
   - Check that your entity has valid property values
   - Some OData 4.0 services require specific headers for save operations

4. **Function query doesn't work**
   - Ensure you're using the OData 4.0 function name (e.g., 'contains' instead of 'substringof')
   - Check parameter order for functions that changed in OData 4.0 