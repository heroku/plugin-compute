"""
This router handles the /handleDataCloudDataChangeEvent endpoint, which acts as a
webhook for Salesforce Data Cloud Data Action events.
"""
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import heroku_applink as sdk
import os

router = APIRouter(
    tags=["datacloud"],
)

class DataCloudEvent(BaseModel):
    ActionDeveloperName: str
    EventType: str
    EventPrompt: str
    SourceObjectDeveloperName: str
    EventPublishDateTime: str
    PayloadCurrentValue: Dict[str, Any]

class DataCloudSchema(BaseModel):
    schemaId: str

class DataCloudRequest(BaseModel):
    events: List[DataCloudEvent]
    schemas: List[DataCloudSchema]

@router.post("/handleDataCloudDataChangeEvent/", status_code=204)
async def handle_data_cloud_change_event(request: DataCloudRequest) -> None:
    """
    Handle Data Cloud Data Action events.

    This endpoint is designed to be a webhook target for Data Cloud Data Actions.
    It parses the incoming event payload and, if environment variables are set,
    can query a connected Data Cloud org.

    :param request: The incoming Data Cloud event payload.
    :type request: DataCloudRequest
    :return: An empty response with a 204 status code.
    :rtype: None
    """
    context = sdk.get_client_context()
    logger = context.logger
    data_cloud = context.data_cloud

    action_event = data_cloud.parse_data_action_event(request.model_dump())
    logger.info(
        f"POST /dataCloudDataChangeEvent: {action_event.count} events for schemas "
        f"{[s.schemaId for s in action_event.schemas] if action_event.schemas else 'n/a'}"
    )

    for evt in action_event.events:
        logger.info(
            f"Got action '{evt.ActionDeveloperName}', event type '{evt.EventType}' "
            f"triggered by {evt.EventPrompt} on object '{evt.SourceObjectDeveloperName}' "
            f"published on {evt.EventPublishDateTime}"
        )
        # In a real application, you would add logic here to handle
        # the changed object values from `evt.PayloadCurrentValue`.

    if os.environ.get("DATA_CLOUD_ORG") and os.environ.get("DATA_CLOUD_QUERY"):
        org_name = os.environ["DATA_CLOUD_ORG"]
        query = os.environ["DATA_CLOUD_QUERY"]
        app_link_addon = context.addons.applink

        logger.info(f"Getting '{org_name}' org connection from Heroku AppLink add-on...")
        org = await app_link_addon.get_authorization(org_name)

        logger.info(f"Querying org '{org_name}' ({org.id}): {query}")
        response = await org.data_cloud_api.query(query)
        logger.info(f"Query response: {response.data}")

    return
