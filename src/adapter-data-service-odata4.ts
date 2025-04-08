import * as breeze from 'breeze-client';
import { appendQueryStringParameter } from './adapter-core';

let core = breeze.core;

declare var window: any;
declare var document: any;
declare var url: any; // needed to access node's url.parse
declare var OData: any;

interface ODataSaveContext extends breeze.SaveContext {
  tempKeys: breeze.EntityKey[];
  contentKeys: breeze.Entity[];
}

/** 
 * OData 4.0 Data Service Adapter
 * Implements the OData 4.0 protocol for Breeze
 * @hidden 
 */
export class DataServiceOData4Adapter extends breeze.AbstractDataServiceAdapter {
  relativeUrl: boolean | ((ds: breeze.DataService, url: string) => string);
  headers: Record<string, string> = { 
    "OData-Version": "4.0", 
    "OData-MaxVersion": "4.0",
    "Accept": "application/json"
  };

  constructor() {
    super();
    this.name = "OData4";
  }

  static register(config?: breeze.BreezeConfig) {
    config = config || breeze.config;
    config.registerAdapter("dataService", DataServiceOData4Adapter);
    return config.initializeAdapterInstance("dataService", "OData4", true) as DataServiceOData4Adapter;
  }

  initialize() {
    OData = core.requireLib("OData", "Needed to support remote OData services");
    OData.jsonHandler.recognizeDates = true;
  }

  // Absolute URL is the default as of Breeze 1.5.5.  
  // To use relative URL (like pre-1.5.5), add adapterInstance.relativeUrl = true:
  //
  //     let ds = breeze.config.initializeAdapterInstance("dataService", "OData4");
  //     ds.relativeUrl = true; 
  //
  // To use custom url construction, add adapterInstance.relativeUrl = myfunction(dataService, url):
  //
  //     let ds = breeze.config.initializeAdapterInstance("dataService", "OData4");
  //     ds.relativeUrl = function(dataService, url) {
  //        return somehowConvert(url);
  //     }
  //

  fetchMetadata(metadataStore: breeze.MetadataStore, dataService: breeze.DataService) {
    let serviceName = dataService.serviceName;

    let url: string;
    if (this.relativeUrl === true) {
      url = dataService.qualifyUrl('$metadata');
    } else if (core.isFunction(this.relativeUrl)) {
      url = (this.relativeUrl as any)(dataService, '$metadata');
    } else {
      url = this.getAbsoluteUrl(dataService, '$metadata');
    }

    let mheaders = core.extend({}, this.headers);
    mheaders["Accept"] = 'application/xml;odata.metadata=full';

    let promise = new Promise((resolve, reject) => {
      OData.read({
        requestUri: url,
        headers: mheaders
      },
        function (data: any) {
          if (!data || !data.dataServices) {
            let error = new Error("Metadata query failed for: " + url);
            return reject(error);
          }
          let csdlMetadata = data.dataServices;

          // might have been fetched by another query
          if (!metadataStore.hasMetadataFor(serviceName)) {
            try {
              metadataStore.importMetadata(csdlMetadata);
            } catch (e) {
              return reject(new Error("Metadata query failed for " + url + "; Unable to process returned metadata: " + e.message));
            }

            metadataStore.addDataService(dataService);
          }

          return resolve(csdlMetadata);

        }, function (error: any) {
          let err = createError(error, url);
          err.message = "Metadata query failed for: " + url + "; " + (err.message || "");
          return reject(err);
        },
        OData.metadataHandler
      );
    });

    return promise;
  }

  executeQuery(mappingContext: breeze.MappingContext) {
    let url: string;
    if (this.relativeUrl === true) {
      url = mappingContext.getUrl();
    } else if (core.isFunction(this.relativeUrl)) {
      url = (this.relativeUrl as any)(mappingContext.dataService, mappingContext.getUrl());
    } else {
      url = this.getAbsoluteUrl(mappingContext.dataService, mappingContext.getUrl());
    }

    // Add query params if .withParameters was used
    let query = mappingContext.query as breeze.EntityQuery;
    if (!core.isEmpty(query.parameters)) {
      let paramString = toQueryString(query.parameters);
      url = appendQueryStringParameter(url, paramString);
    }

    let promise = new Promise<breeze.QueryResult>((resolve, reject) => {
      OData.read({
        requestUri: url,
        headers: core.extend({}, this.headers)
      },
        function (data: any, response: any) {
          let inlineCount: any;
          // OData 4.0 returns count with @odata.count property
          if (data['@odata.count'] !== undefined) {
            inlineCount = parseInt(data['@odata.count'], 10);
          }

          // OData 4.0 returns collection results in the 'value' property
          let results: any;
          if (data.value) {
            results = data.value;
          } else {
            results = data;
          }
          return resolve({ results: results, inlineCount: inlineCount, httpResponse: response, query: query });
        },
        function (error: any) {
          return reject(createError(error, url));
        }
      );
    });
    return promise;
  }

  saveChanges(odataSaveContext: breeze.SaveContext, saveBundle: breeze.SaveBundle): Promise<breeze.SaveResult> {
    let adapter = odataSaveContext.adapter = this;
    let saveContext = odataSaveContext as ODataSaveContext;
    let url: string;
    if (this.relativeUrl === true) {
      saveContext.routePrefix = adapter.getRoutePrefix(saveContext.dataService);
      url = saveContext.dataService.qualifyUrl("$batch");
    } else if (core.isFunction(adapter.relativeUrl)) {
      saveContext.routePrefix = (adapter.relativeUrl as Function)(saveContext.dataService, '');
      url = saveContext.routePrefix + '$batch';
    } else {
      saveContext.routePrefix = adapter.getAbsoluteUrl(saveContext.dataService, '');
      url = saveContext.routePrefix + '$batch';
    }

    let requestData = createChangeRequests(saveContext, saveBundle);
    let tempKeys = saveContext.tempKeys;
    let contentKeys = saveContext.contentKeys;
    
    // Create headers for OData 4.0 batch request
    const batchHeaders = Object.assign({}, this.headers, {
      "Content-Type": "multipart/mixed;boundary=batch_" + generateUuid()
    });
    
    // OData 4.0 batch operations use a different format
    let promise = new Promise<breeze.SaveResult>((resolve, reject) => {
      OData.request({
        headers: batchHeaders,
        requestUri: url,
        method: "POST",
        data: requestData
      }, function (data: any, response: any) {
        let entities: any[] = [];
        let keyMappings: breeze.KeyMapping[] = [];
        let saveResult: breeze.SaveResult = { entities: entities, keyMappings: keyMappings };
        
        // Process batch responses differently in OData 4.0
        // OData 4.0 uses responses array instead of __batchResponses and __changeResponses
        if (data.responses) {
          data.responses.forEach(function (response: any) {
            let statusCode = response.statusCode;
            if ((!statusCode) || statusCode >= 400) {
              reject(createError(response, url));
              return;
            }

            let contentId = response.headers["Content-ID"];
            if (!contentId && response.id) {
              // Some OData 4.0 implementations use different ID formats
              contentId = response.id;
            }

            let rawEntity = response.body;
            if (rawEntity) {
              let tempKey = tempKeys[contentId];
              if (tempKey) {
                let entityType = tempKey.entityType;
                if (entityType.autoGeneratedKeyType !== breeze.AutoGeneratedKeyType.None) {
                  let tempValue = tempKey.values[0];
                  let realKey = entityType.getEntityKeyFromRawEntity(rawEntity, breeze.DataProperty.getRawValueFromServer);
                  let keyMapping = { entityTypeName: entityType.name, tempValue: tempValue, realValue: realKey.values[0] };
                  keyMappings.push(keyMapping);
                }
              }
              entities.push(rawEntity);
            } else {
              let origEntity = contentKeys[contentId];
              entities.push(origEntity);
            }
          });
        }
        return resolve(saveResult);
      }, function (err: any) {
        return reject(createError(err, url));
      }, OData.batchHandler);
    });
    return promise;
  }

  jsonResultsAdapter: breeze.JsonResultsAdapter = new breeze.JsonResultsAdapter({
    name: "OData4_default",

    visitNode: function (node: any, mappingContext: breeze.MappingContext, nodeContext: breeze.NodeContext) {
      let result: any = {};
      if (node == null) return result;
      
      // OData 4.0 uses @odata.type instead of __metadata.type
      let odataType = node['@odata.type'];
      if (odataType) {
        // Remove the # prefix from @odata.type
        let entityTypeName = breeze.MetadataStore.normalizeTypeName(odataType.replace('#', ''));
        let et = entityTypeName && mappingContext.entityManager.metadataStore.getEntityType(entityTypeName, true);
        
        // Same logic as OData 3 for distinguishing projections from entities
        if (et && et._mappedPropertiesCount <= Object.keys(node).length - 1) {
          result.entityType = et;
          
          // OData 4.0 uses @odata.id or @odata.editLink
          let uriKey = node['@odata.id'] || node['@odata.editLink'];
          if (uriKey) {
            // Strip baseUri to make uriKey a relative uri
            let re = new RegExp('^' + mappingContext.dataService.serviceName, 'i');
            uriKey = uriKey.replace(re, '');
          }
          
          result.extraMetadata = {
            uriKey: uriKey,
            etag: node['@odata.etag']
          };
        }
      }
      
      // OData 4.0 returns collection results in the 'value' property
      if (node.value && Array.isArray(node.value)) {
        result.node = node.value;
      }

      let propertyName = nodeContext.propertyName;
      // Handle odata annotations which should be ignored when processing entities
      result.ignore = propertyName && (
        propertyName.startsWith('@odata.') || 
        propertyName === "EntityKey" && node.$type && core.stringStartsWith(node.$type, "System.Data")
      );
      
      return result;
    }
  });

  getAbsoluteUrl(dataService: breeze.DataService, url: string) {
    let serviceName = dataService.qualifyUrl('');
    // only prefix with serviceName if not already on the url
    let base = (core.stringStartsWith(url, serviceName)) ? '' : serviceName;
    // If no protocol, turn base into an absolute URI
    if (window && serviceName.indexOf('//') < 0) {
      // no protocol; make it absolute
      base = window.location.protocol + '//' + window.location.host +
        (core.stringStartsWith(serviceName, '/') ? '' : '/') +
        base;
    }
    return base + url;
  }

  getRoutePrefix(dataService: breeze.DataService) {
    // Get the pathname part of the url (removing baseUrl)
    let serviceName = dataService.serviceName;
    let url = serviceName;
    
    if (window && window.location && serviceName.indexOf('//') < 0) {
      let origin = window.location.origin;
      if (!origin) {
        origin = window.location.protocol + '//' + window.location.host;
      }
      if (core.stringStartsWith(serviceName, '/')) {
        url = origin + serviceName;
      } else {
        url = origin + '/' + serviceName;
      }
    }
    return url;
  }
}

function createChangeRequests(saveContext: ODataSaveContext, saveBundle: breeze.SaveBundle) {
  let adapter = saveContext.adapter as DataServiceOData4Adapter;
  let tempKeys: Record<string, breeze.EntityKey> = saveContext.tempKeys = [];
  let contentKeys: Record<string, breeze.Entity> = saveContext.contentKeys = [];

  let changeRequestInterceptor = (adapter as any).changeRequestInterceptor;
  let batch = createBatch(saveContext);
  
  let propNameFn = saveContext.entityManager.metadataStore.namingConvention.clientPropertyNameToServer;
  
  let i = 0;
  saveBundle.entities.forEach(function (entity) {
    let aspect = entity.entityAspect;
    let currentState = aspect.entityState;
    let request: any = { headers: {} };
    contentKeys[i.toString()] = entity;
    
    request.headers["Content-ID"] = i.toString();
    
    if (changeRequestInterceptor) {
      request = changeRequestInterceptor(request, entity, currentState);
      if (!request) return;
    }
    
    let prefix = saveContext.routePrefix;
    if (currentState === breeze.EntityState.Added) {
      let uniqueID = core.getUuid();
      tempKeys[i.toString()] = aspect.getKey();
      let entityType = entity.entityType;
      let resourceName = entityType.defaultResourceName;
      
      request.requestUri = resourceName;
      if (prefix) request.requestUri = prefix + "/" + resourceName;
      request.method = "POST";
      request.data = removeOdataAnnotations(entity);
    } else if (currentState === breeze.EntityState.Deleted) {
      request.method = "DELETE";
      // use the entityKey because it contains the actually unique identifier
      let entityKey = aspect.getKey();
      let resourceName = entityKey.entityType.defaultResourceName;
      let keyValue = entityKey.values[0];
      
      // OData 4.0 simplified URL format for entity references
      request.requestUri = resourceName + "(" + keyValue + ")";
      if (prefix) request.requestUri = prefix + "/" + resourceName + "(" + keyValue + ")";
      request.headers["If-Match"] = "*";
    } else { // currentState === breeze.EntityState.Modified
      request.method = "PATCH"; // Changed from MERGE to PATCH for OData 4.0
      // use the entityKey because it contains the actually unique identifier
      let entityKey = aspect.getKey();
      let resourceName = entityKey.entityType.defaultResourceName;
      let keyValue = entityKey.values[0];
      
      request.requestUri = resourceName + "(" + keyValue + ")";
      if (prefix) request.requestUri = prefix + "/" + resourceName + "(" + keyValue + ")";
      request.headers["If-Match"] = "*";
      
      // Get changed properties
      const changedProperties: Record<string, any> = {};
      aspect.getPropertyPath().forEach(prop => {
        if (aspect.propertyChanged.propertyHasChanged(prop.name)) {
          changedProperties[prop.name] = entity[prop.name];
        }
      });
      
      request.data = changedProperties;
      
      // Remove any key properties from data - not needed for updates
      let keyProps = entityKey.entityType.keyProperties;
      for (let i = 0; i < keyProps.length; i++) {
        let keyPropName = keyProps[i].nameOnServer || keyProps[i].name;
        delete request.data[keyPropName];
      }
      
      // Remove any @odata annotations
      request.data = removeOdataAnnotations(request.data);
    }

    batch.requests.push(request);
    i++;
  });
  
  return batch;
}

function createBatch(saveContext: ODataSaveContext) {
  // OData 4.0 batch format
  return {
    __batchRequests: [{
      __changeRequests: [] as any[]
    }],
    // API for OData lib to use
    get requests() {
      return this.__batchRequests[0].__changeRequests;
    }
  };
}

function removeOdataAnnotations(data: any) {
  if (!data) return data;
  
  const result = { ...data };
  
  // Remove OData annotations (properties that start with @odata.)
  Object.keys(result).forEach(key => {
    if (key.startsWith('@odata.')) {
      delete result[key];
    }
  });
  
  return result;
}

function toQueryString(obj: Object) {
  const parts: string[] = [];
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = (obj as any)[key];
      if (value !== null && value !== undefined) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      }
    }
  }
  
  return parts.join('&');
}

function createError(error: any, url: string) {
  // OData errors can have a lot of additional info
  let err = new Error() as any;
  
  if (error.response) {
    err.message = error.response.statusText;
    err.statusText = error.response.statusText;
    err.status = error.response.statusCode;
  }
  
  // Sometimes the error response is in error.message
  if (error.message) {
    // Check for OData 4.0 error format with error.message.value
    if (error.message.value && typeof error.message.value === 'string') {
      err.message = error.message.value;
    } else {
      err.message = error.message;
    }
  }
  
  // Handle OData 4.0 error format { error: { message: "", code: "" }}
  if (error.error) {
    if (error.error.message) {
      err.message = error.error.message;
    }
    if (error.error.code) {
      err.errorCode = error.error.code;
    }
  }
  
  err.url = url;
  if (error.stack) {
    err.stack = error.stack;
  }
  return err;
}

function generateUuid() {
  // Simple UUID generation for batch boundaries
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Register this adapter
breeze.config.registerAdapter("dataService", DataServiceOData4Adapter); 