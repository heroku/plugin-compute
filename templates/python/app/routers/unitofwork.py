"""
This router handles the /unitofwork endpoint, demonstrating how to create
multiple related records in Salesforce in a single transaction.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import heroku_applink as sdk

router = APIRouter(
    tags=["unitofwork"],
)

class UnitOfWorkData(BaseModel):
    accountName: str = Field(json_schema_extra={"example": "Test Account"})
    lastName: str = Field(json_schema_extra={"example": "Test"})
    subject: str = Field(json_schema_extra={"example": "Test Case"})
    firstName: Optional[str] = Field(None, json_schema_extra={"example": "First"})
    description: Optional[str] = Field(None, json_schema_extra={"example": "This is a test case."})
    callbackUrl: Optional[str] = Field(None, json_schema_extra={"example": "http://localhost/callback"})

class UnitOfWorkRequest(BaseModel):
    data: UnitOfWorkData

class UnitOfWorkResponse(BaseModel):
    success: bool

@router.post("/", response_model=UnitOfWorkResponse, status_code=201)
async def create_unit_of_work(request: UnitOfWorkRequest) -> UnitOfWorkResponse:
    """
    Asynchronous API that creates a new Account, Contact, and two related Cases
    in the invoking Salesforce org using a Unit of Work.

    This demonstrates the SDK's ability to wrap Salesforce's Composite Graph API,
    allowing for complex, multi-object transactions that either succeed or fail
    as a single unit.

    :param request: The request body containing the data for the new records.
    :type request: UnitOfWorkRequest
    :raises HTTPException: If the commit to Salesforce fails.
    :return: A confirmation of success.
    :rtype: UnitOfWorkResponse
    """
    context = sdk.get_client_context()
    org = context.org
    data_api = org.data_api
    logger = context.logger

    logger.info(f"POST /unitofwork {request.data}")

    uow = data_api.new_unit_of_work()

    account_id = uow.register_create({
        "type": "Account",
        "fields": {"Name": request.data.accountName},
    })

    contact_id = uow.register_create({
        "type": "Contact",
        "fields": {
            "FirstName": request.data.firstName,
            "LastName": request.data.lastName,
            "AccountId": account_id,
        },
    })

    service_case_id = uow.register_create({
        "type": "Case",
        "fields": {
            "Subject": request.data.subject,
            "Description": request.data.description,
            "Origin": "Web", "Status": "New",
            "AccountId": account_id, "ContactId": contact_id,
        },
    })

    followup_case_id = uow.register_create({
        "type": "Case",
        "fields": {
            "ParentId": service_case_id,
            "Subject": "Follow Up", "Description": "Follow up with Customer",
            "Origin": "Web", "Status": "New",
            "AccountId": account_id, "ContactId": contact_id,
        },
    })

    try:
        response = await data_api.commit_unit_of_work(uow)

        callback_response_body = {
            "accountId": response.get(account_id).id,
            "contactId": response.get(contact_id).id,
            "cases": {
                "serviceCaseId": response.get(service_case_id).id,
                "followupCaseId": response.get(followup_case_id).id,
            },
        }

        if request.data.callbackUrl:
            opts = {
                "method": "POST",
                "json": callback_response_body,
                "headers": {"Content-Type": "application/json"},
            }
            callback_response = await org.request(request.data.callbackUrl, opts)
            logger.info(callback_response)

    except Exception as e:
        error_message = f"Failed to insert record. Root Cause: {e}"
        logger.error(error_message)
        raise HTTPException(status_code=500, detail=error_message) from e

    return UnitOfWorkResponse(success=True)
