import * as breeze from 'breeze-client';
import { appendQueryStringParameter } from './adapter-core';

export class UriBuilderOData4Adapter implements breeze.UriBuilderAdapter {

  name: string;

  constructor() {
    this.name = "odata4";
  }

  static register(config?: breeze.BreezeConfig) {
    config = config || breeze.config;
    config.registerAdapter("uriBuilder", UriBuilderOData4Adapter);
    return config.initializeAdapterInstance("uriBuilder", "odata4", true) as UriBuilderOData4Adapter;
  }

  initialize() { }

  buildUri(entityQuery: breeze.EntityQuery, metadataStore: breeze.MetadataStore) {
    // force entityType validation;
    let entityType = entityQuery._getFromEntityType(metadataStore, false);
    if (!entityType) {
      // anonymous type but still has naming convention info avail
      entityType = new breeze.EntityType(metadataStore);
    }

    let queryOptions: Record<string, any> = {};
    queryOptions["$filter"] = toWhereODataFragment(entityQuery.wherePredicate);
    queryOptions["$orderby"] = toOrderByODataFragment(entityQuery.orderByClause!);

    if (entityQuery.skipCount) {
      queryOptions["$skip"] = entityQuery.skipCount;
    }

    if (entityQuery.takeCount != null) {
      queryOptions["$top"] = entityQuery.takeCount;
    }

    queryOptions["$expand"] = toExpandODataFragment(entityQuery.expandClause);
    queryOptions["$select"] = toSelectODataFragment(entityQuery.selectClause!);

    // OData 4.0 uses $count=true instead of $inlinecount=allpages
    if (entityQuery.inlineCountEnabled) {
      queryOptions["$count"] = true;
    }

    const qoText = toQueryOptionsString(queryOptions);

    return appendQueryStringParameter(entityQuery.resourceName, qoText);

    // private methods to this func.

    function toWhereODataFragment(wherePredicate: breeze.Predicate) {
      if (!wherePredicate) return undefined;
      // validation occurs inside of the toODataFragment call here.
      let frag = wherePredicate.visit({ entityType: entityType }, toODataFragmentVisitor);
      return (frag && frag.length > 0) ? frag : undefined;
    }

    function toOrderByODataFragment(orderByClause: breeze.OrderByClause) {
      if (!orderByClause) return undefined;
      orderByClause.validate(entityType!);
      let strings = orderByClause.items.map(function (item) {
        return entityType!.clientPropertyPathToServer(item.propertyPath, "/") + (item.isDesc ? " desc" : "");
      });
      // should return something like CompanyName,Address/City desc
      return strings.join(',');
    }

    function toSelectODataFragment(selectClause?: breeze.SelectClause) {
      if (!selectClause) return undefined;
      selectClause.validate(entityType!);
      let frag = selectClause.propertyPaths.map(function (pp) {
        return entityType!.clientPropertyPathToServer(pp, "/");
      }).join(",");
      return frag;
    }

    function toExpandODataFragment(expandClause?: breeze.ExpandClause) {
      if (!expandClause) return undefined;
      // no validate on expand clauses currently.
      // expandClause.validate(entityType);
      
      // OData 4.0 supports enhanced expand syntax with nested options
      // TODO: Add support for nested expand options like $select within $expand
      // For now, just use the simple syntax
      let frag = expandClause.propertyPaths.map(function (pp) {
        return entityType!.clientPropertyPathToServer(pp, "/");
      }).join(",");
      return frag;
    }

    function toQueryOptionsString(queryOptions: Record<string, any>) {
      let qoStrings: string[] = [];
      for (let qoName in queryOptions) {
        let qoValue = queryOptions[qoName];
        if (qoValue !== undefined) {
          if (qoValue instanceof Array) {
            qoValue.forEach(function (qov) {
              qoStrings.push(qoName + "=" + encodeURIComponent(qov));
            });
          } else {
            qoStrings.push(qoName + "=" + encodeURIComponent(qoValue));
          }
        }
      }

      if (qoStrings.length > 0) {
        return qoStrings.join("&");
      } else {
        return "";
      }
    }
  }
}

// OData 4.0 visitor for converting predicates to OData 4.0 filter syntax
// The main differences:
// 1. 'substringof' function is now 'contains'
// 2. Function parameter order is different for some functions
// 3. Boolean functions no longer need '= true' suffix
let toODataFragmentVisitor = {

  passthruPredicate: function () {
    return this.value;
  },

  unaryPredicate: function (this: breeze.UnaryPredicate, context: breeze.VisitContext) {
    let predVal = this.pred.visit(context);
    return odataOpFrom(this) + " " + "(" + predVal + ")";
  },

  binaryPredicate: function (this: breeze.BinaryPredicate, context: breeze.VisitContext) {
    let expr1Val = this.expr1!.visit(context);
    let expr2Val = this.expr2!.visit(context);
    let prefix = (context as any).prefix;
    if (prefix) {
      expr1Val = prefix + "/" + expr1Val;
    }

    let odataOp = odataOpFrom(this);

    if (this.op.key === 'in') {
      let result = expr2Val.map(function (v: any) {
        return "(" + expr1Val + " eq " + v + ")";
      }).join(" or ");
      return result;
    } else if (this.op.isFunction) {
      // OData 4.0 changes function syntax - no need for '= true' suffix
      if (odataOp === "contains" || odataOp === "endswith" || odataOp === "startswith") {
        // These functions have consistent parameter order in OData 4.0
        return odataOp + "(" + expr1Val + "," + expr2Val + ")";
      } else {
        return odataOp + "(" + expr1Val + "," + expr2Val + ")";
      }
    } else {
      return expr1Val + " " + odataOp + " " + expr2Val;
    }
  },

  andOrPredicate: function (this: breeze.AndOrPredicate, context: breeze.VisitContext) {
    let result = this.preds.map(function (pred) {
      let predVal = pred.visit(context);
      return "(" + predVal + ")";
    }).join(" " + odataOpFrom(this) + " ");
    return result;
  },

  anyAllPredicate: function (this: breeze.AnyAllPredicate, context: breeze.VisitContext) {
    let exprVal = this.expr.visit(context);
    if (!this.pred.op) {
      return exprVal + "/" + odataOpFrom(this) + "()";
    }
    let prefix = (context as any).prefix;
    if (prefix) {
      exprVal = prefix + "/" + exprVal;
      prefix = "x" + (parseInt(prefix.substring(1)) + 1);
    } else {
      prefix = "x1";
    }
    // need to create a new context because of 'prefix'
    let newContext = breeze.core.extend({}, context) as any;
    newContext.entityType = this.expr.dataType;
    newContext.prefix = prefix;
    let newPredVal = this.pred.visit(newContext);
    return exprVal + "/" + odataOpFrom(this) + "(" + prefix + ": " + newPredVal + ")";
  },

  litExpr: function () {
    if (Array.isArray(this.value)) {
      return this.value.map(function (v: any) { return this.dataType.fmtOData(v); }, this);
    } else {
      return this.dataType.fmtOData(this.value);
    }
  },

  propExpr: function (this: breeze.PropExpr, context: breeze.ExpressionContext) {
    let entityType = context.entityType;
    // '/' is the OData path delimiter
    return entityType ? entityType.clientPropertyPathToServer(this.propertyPath, "/") : this.propertyPath;
  },

  fnExpr: function (this: breeze.FnExpr, context: breeze.ExpressionContext) {
    let exprVals = this.exprs.map(function (expr) {
      return expr.visit(context);
    });
    return this.fnName + "(" + exprVals.join(",") + ")";
  }
};

// Map OData 3.0 functions to OData 4.0 functions
let _operatorMap: Record<string, string> = {
  'contains': 'contains',           // No change in OData 4.0
  'startswith': 'startswith',       // No change in OData 4.0
  'endswith': 'endswith',           // No change in OData 4.0
  'substringof': 'contains',        // Changed in OData 4.0 - parameter order also flipped
  'substring': 'substring',         // No change in OData 4.0
  'length': 'length',               // No change in OData 4.0
  'indexof': 'indexof',             // No change in OData 4.0
  'concat': 'concat',               // No change in OData 4.0
  'toupper': 'toupper',             // No change in OData 4.0
  'tolower': 'tolower',             // No change in OData 4.0
  'trim': 'trim',                   // No change in OData 4.0
  'day': 'day',                     // No change in OData 4.0
  'month': 'month',                 // No change in OData 4.0
  'year': 'year',                   // No change in OData 4.0
  'hour': 'hour',                   // No change in OData 4.0
  'minute': 'minute',               // No change in OData 4.0
  'second': 'second',               // No change in OData 4.0
  'round': 'round',                 // No change in OData 4.0
  'floor': 'floor',                 // No change in OData 4.0
  'ceiling': 'ceiling'              // No change in OData 4.0
};

function odataOpFrom(node: any) {
  let op = node.op.key;
  let odataOp = _operatorMap[op];
  return odataOp || op;
}

// Register this adapter with Breeze
breeze.config.registerAdapter("uriBuilder", UriBuilderOData4Adapter);

// Extend Breeze Predicate with OData 4.0 support
(breeze.Predicate.prototype as any).toOData4Fragment = function (context: breeze.VisitContext) {
  return this.visit(context, toODataFragmentVisitor);
}; 