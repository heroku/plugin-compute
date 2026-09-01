"""
This router handles the /accounts endpoint.
"""
import heroku_applink as sdk
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict, Any

router = APIRouter(
    tags=["accounts"],
)

class Account(BaseModel):
    id: str
    name: str

async def _query_accounts(data_api: Any) -> Any:
    """
    Private helper function to query for accounts.

    :param data_api: The Data API client from the Heroku AppLink context.
    :type data_api: Any
    :return: The result of the SOQL query.
    :rtype: Any
    """
    query = "SELECT Id, Name FROM Account"
    result = await data_api.query(query)
    return result

@router.get("/", response_model=List[Account])
async def get_accounts() -> List[Account]:
    """
    Queries for and then returns all Accounts in the invoking org.

    This endpoint demonstrates how to use the Heroku AppLink SDK to perform
    a simple SOQL query against the invoking Salesforce organization.

    :return: A list of Account objects.
    :rtype: List[Account]
    """
    data_api = sdk.get_client_context().data_api
    result = await _query_accounts(data_api)

    accounts = [
        Account(id=record.fields["Id"], name=record.fields["Name"])
        for record in result.records
    ]
    return accounts
