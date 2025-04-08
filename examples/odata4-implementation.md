# OData 4.0 Adapter Implementation Details

This document provides an overview of the OData 4.0 adapter implementation for Breeze. It's intended for developers who want to understand or extend the adapter.

## Architecture Overview

The OData 4.0 support is implemented through two main adapters:

1. **DataServiceOData4Adapter** - Handles data service operations (querying, saving, metadata)
2. **UriBuilderOData4Adapter** - Handles building OData 4.0 compatible URLs from Breeze queries

These adapters are registered with Breeze's adapter registry and can be used by specifying their names when creating a `DataService` instance.

## Key Changes from OData 3.0

### Protocol Changes

1. **Headers**:
   - OData 3.0: `DataServiceVersion: 2.0`
   - OData 4.0: `OData-Version: 4.0`, `OData-MaxVersion: 4.0`

2. **Query Parameters**:
   - OData 3.0: `$inlinecount=allpages`
   - OData 4.0: `$count=true`

3. **Function Names and Syntax**:
   - OData 3.0: `substringof('text', PropertyName) eq true`
   - OData 4.0: `contains(PropertyName, 'text')`

4. **Response Format**:
   - OData 3.0: `__count` for count, `results` for collections, `__metadata.type` for type info
   - OData 4.0: `@odata.count` for count, `value` for collections, `@odata.type` for type info

5. **Batch Operations**:
   - OData 4.0 uses a different multipart format with MIME boundaries

6. **Update Method**:
   - OData 3.0: `MERGE`
   - OData 4.0: `PATCH`

## DataServiceOData4Adapter

### Key Features

1. **Headers Configuration**:
   ```typescript
   headers: Record<string, string> = { 
     "OData-Version": "4.0", 
     "OData-MaxVersion": "4.0",
     "Accept": "application/json"
   };
   ```

2. **Metadata Handling**:
   - Fetches metadata from `$metadata` endpoint
   - Adds appropriate headers for OData 4.0 metadata

3. **Query Execution**:
   - Processes OData 4.0 specific response formats
   - Handles `@odata.count` for inline counts
   - Extracts results from the `value` property for collections

4. **Save Changes**:
   - Uses OData 4.0 batch format
   - Converts entity states to appropriate HTTP methods:
     - Added → POST
     - Modified → PATCH (instead of MERGE)
     - Deleted → DELETE
   - Processes OData 4.0 batch responses

5. **JSON Results Adapter**:
   - Processes OData 4.0 specific metadata annotations (`@odata.*`)
   - Maps entity types based on `@odata.type`
   - Extracts entity references from `@odata.id` or `@odata.editLink`
   - Handles ETag values from `@odata.etag`

## UriBuilderOData4Adapter

### Key Features

1. **OData 4.0 Query Parameters**:
   - `$count=true` for inline counts
   - Standard OData parameters: `$filter`, `$orderby`, `$expand`, `$select`, `$top`, `$skip`

2. **Function Mapping**:
   - Maps OData 3.0 function names to OData 4.0 equivalents
   - Handles parameter order changes (e.g., `substringof` → `contains`)

3. **Predicate Visitor Pattern**:
   - Converts Breeze predicates to OData 4.0 filter expressions
   - Implements specific OData 4.0 function syntax
   - Removes `eq true` suffix for boolean functions

## Implementation Details

### Batch Processing

The OData 4.0 batch processing is implemented with specific attention to:

1. **Request Format**:
   - Proper multipart MIME boundaries
   - Content-ID headers for correlation
   - Appropriate content types

2. **Response Processing**:
   - Parsing the `responses` array
   - Extracting entities from response bodies
   - Mapping temporary keys to real keys

### Error Handling

The adapter implements robust error handling that:

1. Processes OData 4.0 error formats (`error.message`, `error.code`)
2. Extracts detailed information from HTTP responses
3. Creates meaningful error objects with status codes and messages

### Annotation Handling

OData 4.0 uses annotations (properties starting with `@odata.`) extensively:

1. The adapter properly processes these annotations for metadata
2. It removes annotations when sending entities to the server
3. It preserves annotations like `@odata.etag` for optimistic concurrency

## Extension Points

The adapter provides several extension points:

1. **Custom Headers**:
   ```typescript
   const dataServiceAdapter = breeze.config.getAdapterInstance("dataService", "OData4");
   dataServiceAdapter.headers["CustomHeader"] = "Value";
   ```

2. **URL Construction**:
   ```typescript
   dataServiceAdapter.relativeUrl = true;
   // or
   dataServiceAdapter.relativeUrl = (dataService, url) => {
     return customUrlConstruction(dataService, url);
   };
   ```

3. **Change Request Interception**:
   ```typescript
   dataServiceAdapter.changeRequestInterceptor = function(request, entity, entityState) {
     // Modify the request
     return request;
   };
   ```

## Future Enhancements

Potential enhancements to the OData 4.0 adapter:

1. Support for complex `$expand` syntax with nested options
2. Enhanced metadata parsing for OData 4.0 specific features
3. Support for OData Actions and Functions
4. Handling of OData 4.0 delta updates
5. Streaming support for large result sets

## Usage

```typescript
import { DataServiceOData4Adapter, UriBuilderOData4Adapter } from './adapter-odata4';

// Register the adapters
DataServiceOData4Adapter.register();
UriBuilderOData4Adapter.register();

// Create a data service using OData 4.0
const dataService = new breeze.DataService({
  serviceName: "https://services.odata.org/V4/Northwind/Northwind.svc/",
  adapterName: "OData4",
  uriBuilderName: "odata4"
});

const manager = new breeze.EntityManager({ dataService });
```

## Conclusion

The OData 4.0 adapter provides a complete implementation of the OData 4.0 protocol for Breeze clients. It handles the protocol differences while maintaining the same developer experience as other Breeze adapters. 